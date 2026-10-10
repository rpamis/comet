import React, { useEffect, useRef, useState } from 'react';
import { Button } from 'antd';
import { CheckOutlined, CopyOutlined } from '@ant-design/icons';
import { DashboardModal } from './dashboard-modal.jsx';
import { copyText } from './copy-text.js';

export function DashboardChangeSuggestion({ text, identity }) {
  const [openIdentity, setOpenIdentity] = useState(null);
  const [copyState, setCopyState] = useState('');
  const triggerRef = useRef(null);
  const copyButtonRef = useRef(null);
  const closeButtonRef = useRef(null);
  const fullText = text?.trim() ? text : '暂无建议';
  const open = openIdentity === identity;

  useEffect(() => {
    setOpenIdentity(null);
    setCopyState('');
  }, [identity]);
  useEffect(() => setCopyState(''), [fullText]);

  const copySuggestion = async (event) => {
    const button = event.currentTarget;
    try {
      await copyText(fullText, button.closest('.ant-modal-container') ?? document.body);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  return (
    <section className="dashboard-change-suggestion" role="status" aria-label="工作流建议">
      <button
        ref={triggerRef}
        type="button"
        className="dashboard-suggestion-trigger"
        aria-label="展开完整下一步建议"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setCopyState('');
          setOpenIdentity(identity);
        }}
      >
        <span className="dashboard-suggestion-heading">下一步建议</span>
        <span className="dashboard-suggestion-preview">{fullText.replace(/\s+/gu, ' ')}</span>
      </button>
      <DashboardModal
        open={open}
        title="完整下一步建议"
        ariaLabel="完整下一步建议"
        className="dashboard-suggestion-modal"
        showFullscreenToggle={false}
        wrapProps={{
          onKeyDownCapture: (event) => {
            if (!open || event.key !== 'Tab') return;
            // Chrome 移焦到浏览器界面时没有页面 focusin，需显式处理两个按钮的循环边界。
            const first = copyButtonRef.current;
            const last = closeButtonRef.current;
            if (event.shiftKey && event.target === first) {
              event.preventDefault();
              last?.focus({ preventScroll: true });
            } else if (!event.shiftKey && event.target === last) {
              event.preventDefault();
              first?.focus({ preventScroll: true });
            }
          },
        }}
        onClose={() => setOpenIdentity(null)}
        afterClose={() => {
          if (triggerRef.current?.isConnected) triggerRef.current.focus({ preventScroll: true });
        }}
        footer={
          <div className="dashboard-suggestion-actions">
            {copyState === 'failed' && <span role="alert">复制失败，请选择全文手动复制。</span>}
            <Button
              ref={copyButtonRef}
              aria-label="复制完整建议"
              icon={copyState === 'copied' ? <CheckOutlined /> : <CopyOutlined />}
              onClick={copySuggestion}
            >
              <span role="status">{copyState === 'copied' ? '已复制' : '复制全文'}</span>
            </Button>
            <Button
              ref={closeButtonRef}
              type="primary"
              aria-label="关闭"
              onClick={() => setOpenIdentity(null)}
            >
              关闭
            </Button>
          </div>
        }
      >
        <pre className="dashboard-suggestion-full-text">{fullText}</pre>
      </DashboardModal>
    </section>
  );
}
