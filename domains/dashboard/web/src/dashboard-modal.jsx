import { useEffect, useState } from 'react';
import { Button, Modal, Tooltip } from 'antd';
import { FullscreenExitOutlined, FullscreenOutlined } from '@ant-design/icons';

export function useDashboardModalState(open) {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!open) setFullscreen(false);
  }, [open]);

  const toggleFullscreen = () => setFullscreen((value) => !value);
  const requestClose = (onClose) => {
    if (fullscreen) {
      setFullscreen(false);
      return;
    }
    onClose();
  };

  return { fullscreen, toggleFullscreen, requestClose };
}

function DashboardModalTitle({ title, subtitle, description, fullscreen, onToggleFullscreen }) {
  return (
    <div className="dashboard-modal-title dashboard-settings-modal-title">
      <div className="dashboard-modal-title-copy dashboard-settings-modal-title-copy">
        <div>
          <div className="dashboard-settings-modal-title-row">
            <strong>{title}</strong>
            {subtitle && <span className="dashboard-tool-counter">{subtitle}</span>}
          </div>
          {description && <p>{description}</p>}
        </div>
      </div>
      <Tooltip title={fullscreen ? '退出全屏' : '全屏展示'} placement="bottom">
        <Button
          className="dashboard-modal-expand dashboard-settings-modal-expand"
          type="text"
          icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
          aria-label={fullscreen ? '退出全屏' : '全屏展示'}
          aria-pressed={fullscreen}
          onClick={onToggleFullscreen}
        />
      </Tooltip>
    </div>
  );
}

export function DashboardModal({
  open,
  title,
  subtitle,
  description,
  ariaLabel,
  width = 720,
  className = '',
  rootClassName = '',
  footer,
  onClose,
  children,
  ...modalProps
}) {
  const { fullscreen, toggleFullscreen, requestClose } = useDashboardModalState(open);
  const modalClassName = ['dashboard-modal', className, fullscreen ? 'is-fullscreen' : '']
    .filter(Boolean)
    .join(' ');
  const modalRootClassName = [
    'dashboard-modal-root',
    rootClassName,
    fullscreen ? 'is-fullscreen' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Modal
      {...modalProps}
      rootClassName={modalRootClassName}
      className={modalClassName}
      centered
      width={fullscreen ? '100vw' : width}
      open={open}
      keyboard
      mask={{ closable: true }}
      destroyOnHidden
      closeIcon={null}
      aria-label={ariaLabel}
      onCancel={() => requestClose(onClose)}
      title={
        <DashboardModalTitle
          title={title}
          subtitle={subtitle}
          description={description}
          fullscreen={fullscreen}
          onToggleFullscreen={toggleFullscreen}
        />
      }
      footer={footer}
    >
      {typeof children === 'function' ? children({ fullscreen }) : children}
    </Modal>
  );
}
