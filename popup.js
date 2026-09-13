const STORAGE_KEY = 'lioden_hoard_organizer_data';

document.addEventListener('DOMContentLoaded', () => {
  const statFolders = document.getElementById('stat-folders');
  const statMapped = document.getElementById('stat-mapped');
  const folderList = document.getElementById('popup-folder-list');
  const btnExport = document.getElementById('btn-export-backup');

  function loadData(callback) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([STORAGE_KEY], (res) => {
        callback(res[STORAGE_KEY] || {});
      });
    } else {
      const raw = localStorage.getItem(STORAGE_KEY);
      callback(raw ? JSON.parse(raw) : {});
    }
  }

  loadData((data) => {
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
      loadData((data) => {
        const extVersion = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest)
          ? (chrome.runtime.getManifest()?.version || '1.0.2')
          : '1.0.2';
        const exportData = {
          version: extVersion,
          exportedAt: new Date().toISOString(),
          folders: data.folders || [],
          itemMap: data.itemMap || {},
          instanceMap: data.instanceMap || {}
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `lioden_hoard_folders_${new Date().toISOString().slice(0,10)}.json`;
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
