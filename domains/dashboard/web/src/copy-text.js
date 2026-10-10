export async function copyText(text, container = document.body) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Clipboard API 不可用时，仍允许在当前弹窗或页面内复制。
    }
  }

  const activeElement = container.getRootNode().activeElement ?? document.activeElement;
  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  container.append(input);
  try {
    input.select();
    if (!document.execCommand('copy')) throw new Error('当前浏览器不支持复制');
  } finally {
    input.remove();
    if (activeElement?.isConnected) activeElement.focus({ preventScroll: true });
  }
}
