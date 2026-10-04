/**
 * Universal Clipboard Copy Utility
 * 
 * Works seamlessly across:
 * - HTTPS and localhost (modern navigator.clipboard API)
 * - HTTP and remote VPS deployments like Oracle Cloud (document.execCommand fallback)
 * - Mobile browsers (iOS Safari, Android Chrome) and desktop browsers
 */

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // 1. Try modern navigator.clipboard if supported
  if (typeof window !== 'undefined' && navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Non-secure HTTP origin on remote VPS (like Oracle http://ip:3000) or browser restrictions
    }
  }

  // 2. Universal fallback using temporary textarea
  if (typeof document === 'undefined') return false;

  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;

    // Must be part of DOM and interactable for execCommand('copy')
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.width = '200px';
    textArea.style.height = '100px';
    textArea.style.padding = '0';
    textArea.style.border = 'none';
    textArea.style.outline = 'none';
    textArea.style.boxShadow = 'none';
    textArea.style.background = 'transparent';
    textArea.style.color = 'transparent';
    textArea.style.opacity = '0.01';
    textArea.style.zIndex = '-9999';

    // Note: Do NOT set readonly on some browsers (especially mobile/WebKit) as it inhibits execCommand
    textArea.setAttribute('contenteditable', 'true');

    document.body.appendChild(textArea);

    // Selection
    textArea.focus({ preventScroll: true });
    textArea.select();
    textArea.setSelectionRange(0, text.length);

    let successful = false;
    try {
      successful = document.execCommand('copy');
    } catch (e) {
      successful = false;
    }

    document.body.removeChild(textArea);

    if (successful) {
      return true;
    }
  } catch (err) {
    console.warn('execCommand copy fallback encountered error:', err);
  }

  return false;
}
