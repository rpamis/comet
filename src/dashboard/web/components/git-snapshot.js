// Git snapshot card (always visible).

import { escape } from '../utils.js';

export function renderGitSnapshot({ git }) {
  const badge = document.getElementById('dirtyBadge');
  badge.textContent = `${git.dirtyFiles} 个未提交`;
  badge.className = `pill ${git.dirtyFiles > 0 ? 'status-warn' : 'status-ok'}`;

  document.getElementById('gitSnapshot').innerHTML = `
    <div class="git-row"><span>分支</span><strong class="mono">${escape(git.branch ?? '—')}</strong></div>
    <div class="git-row"><span>HEAD</span><strong class="mono">${escape(git.head ?? '—')}</strong></div>
    <div class="git-row"><span>未提交</span><strong class="mono">${git.dirtyFiles} 个文件</strong></div>
  `;

  document.getElementById('commitList').innerHTML = git.recentCommits.length
    ? git.recentCommits.map((c) => `<li class="mono">${escape(c)}</li>`).join('')
    : '<li class="muted">无提交记录</li>';

  document.getElementById('dirtyList').innerHTML = git.dirtyFileList.length
    ? git.dirtyFileList
        .map((f) => `<li class="mono"><span class="flag">M</span>${escape(f)}</li>`)
        .join('')
    : '<li class="muted">工作区干净</li>';
}
