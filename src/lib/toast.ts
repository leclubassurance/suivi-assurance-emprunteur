export function showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
  if (typeof (window as any).showAppToast === 'function') {
    (window as any).showAppToast(message, type);
  } else {
    try {
      console.log(`[TOAST - ${type}] ${message}`);
      alert(message);
    } catch (e) {
      console.warn("Blocked alert: ", message);
    }
  }
}
