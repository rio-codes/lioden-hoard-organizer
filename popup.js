const STORAGE_KEY = 'lioden_hoard_organizer_data';
const SETTINGS_KEY = 'lioden_hoard_organizer_settings';

document.addEventListener('DOMContentLoaded', () => {
  const statFolders = document.getElementById('stat-folders');
  const statMapped = document.getElementById('stat-mapped');
  const folderList = document.getElementById('popup-folder-list');
  const btnExport = document.getElementById('btn-export-backup');

  function loadData(callback) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(null, (allRes) => {
        const settings = allRes[SETTINGS_KEY] || {};
        const mode = settings.linkedAccountsMode || 'shared';
        let activeKey = STORAGE_KEY;
        if (mode === 'separate' && settings.lastActiveAccount) {
          const accKey = STORAGE_KEY + '_' + settings.lastActiveAccount;
          if (allRes[accKey]) activeKey = accKey;
        }
        callback(allRes[activeKey] || allRes[STORAGE_KEY] || {}, settings, activeKey);
      });
    } else {
      const rawSettings = localStorage.getItem(SETTINGS_KEY);
      const settings = rawSettings ? JSON.parse(rawSettings) : {};
      const mode = settings.linkedAccountsMode || 'shared';
      let activeKey = STORAGE_KEY;
      if (mode === 'separate' && settings.lastActiveAccount) {
        const accKey = STORAGE_KEY + '_' + settings.lastActiveAccount;
        if (localStorage.getItem(accKey)) activeKey = accKey;
      }
      const raw = localStorage.getItem(activeKey) || localStorage.getItem(STORAGE_KEY);
      callback(raw ? JSON.parse(raw) : {}, settings, activeKey);
    }
  }

  // Set header version from manifest if available
  const versionEl = document.querySelector('.header-version');
  if (versionEl) {
    const extVer = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest)
      ? chrome.runtime.getManifest()?.version
      : '1.1.5';
    if (extVer) versionEl.textContent = `v${extVer}`;
  }

  loadData((data, settings, activeKey) => {
    // Apply theme
    const themeToApply = (settings.theme && settings.theme !== 'auto') 
      ? settings.theme 
      : (settings.detectedTheme || 'day');
    document.body.setAttribute('data-theme', themeToApply);

    // Display account badge if in separate mode
    const badge = document.getElementById('popup-account-badge');
    if (badge) {
      if (settings.linkedAccountsMode === 'separate' && settings.lastActiveAccount) {
        const acc = (settings.knownAccounts && settings.knownAccounts[settings.lastActiveAccount]) || {};
        badge.textContent = `👤 Account #${settings.lastActiveAccount}${acc.name ? ` (${acc.name})` : ''} • Separate`;
        badge.style.display = 'block';
      } else {
        badge.style.display = 'none';
      }
    }

    const folders = data.folders || [];
    const itemMap = data.itemMap || {};
    const instanceMap = data.instanceMap || {};

    // Count how many items in each folder
    const folderCounts = {};
    Object.values(itemMap).forEach(fId => {
      folderCounts[fId] = (folderCounts[fId] || 0) + 1;
    });

    const totalMapped = Object.keys(itemMap).length + Object.keys(instanceMap).length;

    statFolders.textContent = folders.length;
    statMapped.textContent = totalMapped;

    if (folders.length === 0) {
      folderList.innerHTML = `
        <div style="padding: 10px; text-align: center; color: var(--text-muted); font-size: 11px;">
          No folders yet. Create folders on the hoard page!
        </div>
      `;
      return;
    }

    folderList.innerHTML = folders.map(f => {
      const count = folderCounts[f.id] || 0;
      return `
        <div class="folder-item">
          <div class="folder-name-wrap">
            <span class="folder-dot" style="background: ${f.color || '#6D381F'};"></span>
            <span>${f.icon || '📁'}</span>
            <span>${escapeHtml(f.name)}</span>
          </div>
          <span class="folder-badge">${count} types</span>
        </div>
      `;
    }).join('');
  });

  if (btnExport) {
    btnExport.addEventListener('click', () => {
      loadData((data, settings) => {
        const extVersion = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest)
          ? (chrome.runtime.getManifest()?.version || '1.1.5')
          : '1.1.5';
        const exportData = {
          version: extVersion,
          exportedAt: new Date().toISOString(),
          account: settings.lastActiveAccount || null,
          linkedAccountsMode: settings.linkedAccountsMode || 'shared',
          folders: data.folders || [],
          itemMap: data.itemMap || {},
          instanceMap: data.instanceMap || {}
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const accSuffix = (settings.linkedAccountsMode === 'separate' && settings.lastActiveAccount) ? `_acc${settings.lastActiveAccount}` : '';
        a.download = `lioden_hoard_folders${accSuffix}_${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
      });
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});
