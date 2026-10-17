import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from 'react';
import { Button, Radio, Slider } from 'antd';
import { MoonOutlined, SunOutlined } from '@ant-design/icons';
import './dashboard-appearance.css';
import { t } from './dashboard-i18n.js';
import { useDashboardLanguage } from './dashboard-language.jsx';
import {
  FONT_SCALE_STORAGE_KEY,
  normalizeFontScale,
  readFontScale,
  writeFontScale,
} from './font-scale.js';

export const DashboardAppearanceContext = createContext(null);

export function useDashboardFontScale({ embedded = false, themeRoot = null } = {}) {
  const [fontScale, setFontScale] = useState(() => (embedded ? 100 : readFontScale()));
  useLayoutEffect(() => {
    const root = embedded ? themeRoot : document.documentElement;
    root?.style.setProperty('--dashboard-font-scale', String(fontScale / 100));
    if (!embedded) writeFontScale(fontScale);
  }, [embedded, themeRoot, fontScale]);
  useEffect(() => {
    if (embedded) return undefined;
    const sync = (event) => {
      if (event.key === FONT_SCALE_STORAGE_KEY || event.key === null) setFontScale(readFontScale());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [embedded]);
  const updateFontScale = useCallback((value) => setFontScale(normalizeFontScale(value)), []);
  return { fontScale, updateFontScale, embedded };
}

export function DashboardAppearanceSettings() {
  useDashboardLanguage();
  const { fontScale, updateFontScale, embedded, theme, updateTheme } = useContext(
    DashboardAppearanceContext,
  );
  return (
    <div className="dashboard-settings-stack dashboard-appearance-settings">
      <div className="dashboard-settings-section-head">
        <h3>{t('外观')}</h3>
        <p>
          {t(
            embedded
              ? '调整当前预览的文字大小，重新加载后恢复默认。'
              : '调整主题和文字大小，所有项目沿用此浏览器的偏好。',
          )}
        </p>
      </div>
      <section
        className="dashboard-settings-panel dashboard-theme-panel"
        aria-labelledby="dashboard-theme-label"
      >
        <div className="dashboard-theme-heading">
          <h4 id="dashboard-theme-label">{t('主题模式')}</h4>
          <p>{t(embedded ? '官网预览固定为亮色模式' : '选择适合你的工作环境，即时生效。')}</p>
        </div>
        <Radio.Group
          name="dashboard-theme"
          role="radiogroup"
          aria-labelledby="dashboard-theme-label"
          className="dashboard-theme-options"
          value={theme}
          onChange={(event) => updateTheme(event.target.value)}
          disabled={embedded}
        >
          {[
            {
              value: 'light',
              label: '亮色',
              description: '明亮、清晰的工作界面',
              Icon: SunOutlined,
            },
            { value: 'dark', label: '暗色', description: '适合低光环境', Icon: MoonOutlined },
          ].map(({ value, label, description, Icon }) => (
            <Radio key={value} value={value} aria-label={t(label)} className="dashboard-theme-card">
              <span className={`dashboard-theme-preview is-${value}`} aria-hidden="true">
                <span className="theme-preview-sidebar">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <span className="theme-preview-content">
                  <span className="theme-preview-toolbar" />
                  <span className="theme-preview-cards">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="theme-preview-chart">
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                </span>
              </span>
              <span className="dashboard-theme-card-copy">
                <strong>
                  <Icon />
                  {t(label)}
                </strong>
                <span>{t(description)}</span>
              </span>
            </Radio>
          ))}
        </Radio.Group>
      </section>
      <section className="dashboard-settings-panel" aria-labelledby="dashboard-font-size-label">
        <div className="dashboard-font-size-heading">
          <h4 id="dashboard-font-size-label">{t('字体大小')}</h4>
          <output aria-live="polite">
            {fontScale}%{fontScale === 100 ? ` · ${t('默认')}` : ''}
          </output>
        </div>
        <div className="dashboard-font-size-control">
          <span aria-hidden="true" className="dashboard-font-size-small">
            A
          </span>
          <Slider
            min={90}
            max={150}
            step={5}
            value={fontScale}
            onChange={updateFontScale}
            marks={{ 100: t('默认') }}
            ariaLabelForHandle={t('字体大小')}
            tooltip={{ formatter: (value) => `${value}%` }}
          />
          <span aria-hidden="true" className="dashboard-font-size-large">
            A
          </span>
        </div>
        <div className="dashboard-font-size-actions">
          <span>{t('拖动即时生效，100% 保持原有字号。')}</span>
          <Button onClick={() => updateFontScale(100)} disabled={fontScale === 100}>
            {t('恢复默认')}
          </Button>
        </div>
      </section>
    </div>
  );
}
