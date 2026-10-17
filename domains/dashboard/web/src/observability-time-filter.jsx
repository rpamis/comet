import React, { useState } from 'react';
import { Button, DatePicker, Dropdown } from 'antd';
import { CalendarOutlined, DownOutlined } from '@ant-design/icons';
import { DashboardModal } from './dashboard-modal.jsx';
import { t, getDashboardLocale } from './dashboard-i18n.js';

export function observabilityRangeLabel(selection) {
  return selection.preset === 'custom'
    ? `${new Date(selection.from).toLocaleString(getDashboardLocale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })} – ${new Date(selection.to).toLocaleString(getDashboardLocale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}`
    : t(
        { '1h': '最近 1 小时', '24h': '最近 24 小时', '3d': '最近 3 天', '7d': '最近 7 天' }[
          selection.preset
        ] ?? '最近 7 天',
      );
}

export function ObservabilityTimeFilter({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const validDraft =
    draft?.[0] &&
    draft?.[1] &&
    draft[0].valueOf() <= draft[1].valueOf() &&
    draft[0].valueOf() >= Date.now() - 7 * 86400000 &&
    draft[1].valueOf() <= Date.now();
  const options = ['1h', '24h', '3d', '7d'].map((preset) => ({
    key: preset,
    label: observabilityRangeLabel({ preset }),
  }));
  return (
    <>
      <Dropdown
        menu={{
          items: [...options, { type: 'divider' }, { key: 'custom', label: t('自定义时间范围') }],
          selectedKeys: [value.preset],
          onClick: ({ key }) => {
            if (key === 'custom') {
              setDraft(null);
              setOpen(true);
            } else onChange({ preset: key });
          },
        }}
        trigger={['click']}
      >
        <Button
          className="observability-time-filter"
          icon={<CalendarOutlined />}
          aria-label={`${t('时间范围')}：${observabilityRangeLabel(value)}`}
        >
          <span>{observabilityRangeLabel(value)}</span>
          <DownOutlined />
        </Button>
      </Dropdown>
      <DashboardModal
        open={open}
        title={t('自定义时间范围')}
        onClose={() => setOpen(false)}
        width={560}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>{t('取消')}</Button>
            <Button
              type="primary"
              disabled={!validDraft}
              onClick={() => {
                onChange({
                  preset: 'custom',
                  from: draft[0].toISOString(),
                  to: draft[1].toISOString(),
                });
                setOpen(false);
              }}
            >
              {t('应用时间范围')}
            </Button>
          </>
        }
      >
        <p>{t('选择最近 7 天内的时间。时间筛选不影响实时状态快照。')}</p>
        <DatePicker.RangePicker
          key={String(open)}
          showTime
          format="YYYY-MM-DD HH:mm"
          value={draft}
          onChange={setDraft}
          style={{ width: '100%' }}
          classNames={{ popup: { root: 'observability-time-picker-popup' } }}
          disabledDate={(current) =>
            current &&
            (current.endOf('day').valueOf() < Date.now() - 7 * 86400000 ||
              current.startOf('day').valueOf() > Date.now())
          }
        />
      </DashboardModal>
    </>
  );
}
