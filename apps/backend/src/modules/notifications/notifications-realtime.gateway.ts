import { Inject, Injectable } from '@nestjs/common'
import type { OnModuleDestroy } from '@nestjs/common'
import type { Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { Client } from 'pg'
import { WebSocket, WebSocketServer } from 'ws'
import { z } from 'zod'
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js'
import { AccessService } from '../access/access.service.js'
import { AuthService } from '../auth/auth.service.js'

const websocketPath = '/api/v1/notifications/ws'
const notificationSignalSchema = z.object({
  type: z.enum(['notification.created', 'notification.read']),
  recipientUserId: z.string().min(1).max(200),
  entityId: z.uuid(),
  notificationId: z.uuid(),
  notificationType: z.string().min(1).max(100),
}).strict()

type NotificationSignal = z.infer<typeof notificationSignalSchema>
type Connection = { socket: WebSocket; userId: string; entityId: string; cookie: string; isAlive: boolean }

@Injectable()
export class NotificationsRealtimeGateway implements OnModuleDestroy {
  private server?: Server
  private websocketServer?: WebSocketServer
  private listener?: Client
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private heartbeat?: ReturnType<typeof setInterval>
  private stopped = false
  private readonly connections = new Map<string, Set<Connection>>()

  constructor(
    private readonly auth: AuthService,
    private readonly access: AccessService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async start(server: Server) {
    if (this.websocketServer) return
    this.stopped = false
    this.server = server
    this.websocketServer = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false })
    server.on('upgrade', this.handleUpgrade)
    this.heartbeat = setInterval(() => {
      for (const group of this.connections.values()) for (const connection of group) {
        if (connection.socket.readyState !== WebSocket.OPEN) continue
        if (!connection.isAlive) {
          connection.socket.terminate()
          continue
        }
        connection.isAlive = false
        connection.socket.ping()
      }
    }, 30_000)
    this.heartbeat.unref?.()
    await this.connectListener()
  }

  async onModuleDestroy() {
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.server?.off('upgrade', this.handleUpgrade)
    this.server = undefined
    for (const group of this.connections.values()) for (const connection of group) connection.socket.close(1001, 'Server shutting down')
    this.connections.clear()
    const websocketServer = this.websocketServer
    this.websocketServer = undefined
    if (websocketServer) await new Promise<void>((resolve) => websocketServer.close(() => resolve()))
    const listener = this.listener
    this.listener = undefined
    if (listener) await listener.end().catch(() => undefined)
  }

  private readonly handleUpgrade = (request: import('node:http').IncomingMessage, socket: Duplex, head: Buffer) => {
    let url: URL
    try { url = new URL(request.url ?? '/', 'http://localhost') } catch { return this.reject(socket, 400, 'Bad Request') }
    if (url.pathname !== websocketPath) return
    void this.authorizeUpgrade(request, socket, head, url).catch(() => this.reject(socket, 403, 'Forbidden'))
  }

  private async authorizeUpgrade(request: import('node:http').IncomingMessage, socket: Duplex, head: Buffer, url: URL) {
    const origin = request.headers.origin
    const cookies = request.headers.cookie
    const entityId = url.searchParams.get('entityId')
    if (!origin || !this.config.trustedOrigins.includes(origin)) return this.reject(socket, 403, 'Forbidden')
    if (!cookies || !entityId || url.searchParams.getAll('entityId').length !== 1 || [...url.searchParams.keys()].some((key) => key !== 'entityId') || !z.uuid().safeParse(entityId).success) {
      return this.reject(socket, 400, 'Bad Request')
    }

    const session = await this.auth.getSession(request.headers)
    if (!session) return this.reject(socket, 401, 'Unauthorized')
    try {
      await this.access.requireEntityPermission(session.user.id, entityId, 'notifications.read')
    } catch {
      return this.reject(socket, 403, 'Forbidden')
    }
    if (socket.destroyed || !this.websocketServer) return

    this.websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      const connection: Connection = { socket: websocket, userId: session.user.id, entityId, cookie: cookies, isAlive: true }
      const key = this.connectionKey(connection.userId, connection.entityId)
      const group = this.connections.get(key) ?? new Set<Connection>()
      group.add(connection)
      this.connections.set(key, group)
      const remove = () => {
        group.delete(connection)
        if (!group.size && this.connections.get(key) === group) this.connections.delete(key)
      }
      websocket.once('close', remove)
      websocket.once('error', remove)
      websocket.on('pong', () => { connection.isAlive = true })
      websocket.on('message', () => websocket.close(1008, 'Notifications channel is server-to-client only'))
      websocket.send(JSON.stringify({ type: 'ready', entityId }))
    })
  }

  private reject(socket: Duplex, status: 400 | 401 | 403, reason: string) {
    if (socket.destroyed) return
    socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  }

  private connectionKey(userId: string, entityId: string) {
    return `${userId}:${entityId}`
  }

  private async connectListener() {
    if (this.stopped) return
    const client = new Client({ connectionString: this.config.databaseUrl })
    this.listener = client
    client.on('notification', (message) => {
      if (message.channel === 'atlas_notifications' && message.payload) void this.dispatch(message.payload)
    })
    client.on('error', (error) => this.listenerFailed(client, error))
    try {
      await client.connect()
      await client.query('LISTEN atlas_notifications')
    } catch (error) {
      this.listenerFailed(client, error instanceof Error ? error : new Error(String(error)))
    }
  }

  private listenerFailed(client: Client, error: Error) {
    if (this.listener !== client || this.stopped) return
    this.listener = undefined
    console.error(JSON.stringify({ event: 'NOTIFICATION_LISTENER_FAILED', message: error.message }))
    for (const group of this.connections.values()) for (const connection of group) connection.socket.close(1012, 'Realtime notification service reconnecting')
    this.connections.clear()
    void client.end().catch(() => undefined)
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      void this.connectListener()
    }, 5000)
    this.reconnectTimer.unref?.()
  }

  private async dispatch(raw: string) {
    let value: unknown
    try { value = JSON.parse(raw) } catch { return }
    const parsed = notificationSignalSchema.safeParse(value)
    if (!parsed.success) return
    const signal: NotificationSignal = parsed.data
    const group = this.connections.get(this.connectionKey(signal.recipientUserId, signal.entityId))
    if (!group?.size) return
    await Promise.all([...group].map(async (connection) => {
      if (connection.socket.readyState !== WebSocket.OPEN) return
      try {
        const session = await this.auth.getSession({ cookie: connection.cookie })
        if (!session || session.user.id !== connection.userId) throw new Error('Session expired')
        await this.access.requireEntityPermission(connection.userId, connection.entityId, 'notifications.read')
        if (connection.socket.readyState === WebSocket.OPEN) connection.socket.send(JSON.stringify({
          type: signal.type, entityId: signal.entityId, notificationId: signal.notificationId, notificationType: signal.notificationType,
        }))
      } catch {
        connection.socket.close(1008, 'Session or notification permission expired')
      }
    }))
  }
}
