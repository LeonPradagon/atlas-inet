import Swal from 'sweetalert2'
import { errorMessage } from './api'

let pending = 0

export function beginProcess() {
  pending += 1
  if (pending === 1) {
    void Swal.fire({
      title: 'Sedang memproses',
      text: 'Mohon tunggu sebentar…',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading(),
    })
  }
}

export function finishProcess(result: { error?: unknown } = {}) {
  pending = Math.max(0, pending - 1)
  if (pending > 0) return
  Swal.close()
  if (result.error !== undefined) {
    void Swal.fire({ toast: true, position: 'top-end', icon: 'error', title: errorMessage(result.error), showConfirmButton: false, timer: 5000, timerProgressBar: true })
  } else {
    void Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Berhasil diproses', showConfirmButton: false, timer: 2500, timerProgressBar: true })
  }
}
