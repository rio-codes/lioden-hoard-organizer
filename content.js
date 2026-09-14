/**
 * Lioden Hoard Organizer - Content Script
 * Provides user-created folders, aggregated hoard views, instant search,
 * drag-and-drop sorting, and seamless integration with native actions.
 */

(function () {
  'use strict';

  if (window.__LHO_INITIALIZED__) return;
  window.__LHO_INITIALIZED__ = true;

  const URL_STATIC = 'https://static.lioden.com';

  // Storage Keys
  const STORAGE_KEY = 'lioden_hoard_organizer_data';
  const SETTINGS_KEY = 'lioden_hoard_organizer_settings';

  // Default Preset Folders
  const DEFAULT_FOLDERS = [];

  const PRESET_ICONS = ['📁', '💎', '🦁', '🍖', '🌿', '✨', '🦴', '🎭', '🧪', '📦', '👑', '🛡️', '🌙', '☀️', '🐾', '🏷️'];
  const PRESET_COLORS = ['#8E4C2A', '#C78B2A', '#4E7A36', '#3D405B', '#A32A2A', '#2B6CB0', '#2C7A7B', '#805AD5', '#4A5568'];

  // State
  let hoardData = null; // { itemData, inventoryData }
  let userFolders = [];
  let itemFolderMap = {};     // catalog itemId -> folderId
  let instanceFolderMap = {}; // instanceId -> folderId
  let activeFolderId = 'unsorted'; // 'all', 'unsorted', or folder.id
  let searchQuery = '';
  let categoryFilter = 'all';
  let sortBy = 'name_asc';
  let pageSize = 'all'; // 'all', 60, 120, 240
  let currentTheme = 'auto'; // 'auto', 'day', 'night', 'desert'
  let resolvedTheme = 'day'; // 'day', 'night', 'desert'
  let currentPage = 1;
  let isFolderViewEnabled = true;
  let isFoldersCollapsed = false;
  let draggingFolderId = null;

  // Linked Accounts State (Main & Side)
  let currentMid = null;
  let currentAccountName = '';
  let linkedAccountsMode = 'shared'; // 'shared' or 'separate'
  let knownAccounts = {};            // { [mid]: { mid, name, lastSeen } }
  let activeFolderIdByAccount = {};  // { [mid]: folderId }

  // Selected checkbox values across current view
  let selectedItems = new Set(); // Set of string values

  // Active Tooltip element
  let tooltipEl = null;

  // Buried vs Hoard Simulation State (for file: preview)
  let simulatedActiveInventory = null;
  let simulatedBuriedInventory = null;

  function checkIsBuriedPage() {
    if (window.location.protocol === 'file:') {
      return window.location.hash === '#buried';
    }
    return new URLSearchParams(window.location.search).get('page') === 'buried';
  }

  function checkIsStackPage() {
    if (window.location.protocol === 'file:') {
      return window.location.hash.startsWith('#stack') || new URLSearchParams(window.location.search).has('stack');
    }
    return new URLSearchParams(window.location.search).has('stack');
  }

  function initSimulatedInventories() {
    if (window.location.protocol === 'file:' && !simulatedActiveInventory && hoardData) {
      simulatedActiveInventory = [...hoardData.inventoryData];
      if (simulatedActiveInventory.length > 3) {
        simulatedBuriedInventory = simulatedActiveInventory.splice(simulatedActiveInventory.length - 3, 3);
      } else {
        simulatedBuriedInventory = [];
      }
    }
  }

  function getCurrentInventory() {
    if (window.location.protocol === 'file:') {
      initSimulatedInventories();
      return checkIsBuriedPage() ? (simulatedBuriedInventory || []) : (simulatedActiveInventory || []);
    }
    return hoardData ? hoardData.inventoryData : [];
  }

  function getNativeInputInfo(type) {
    if (type === 'bury') {
      const native = document.querySelector('input[value*="Bury Checked"], input[name="buryall"]');
      return { name: native ? native.name : 'buryall', value: native ? native.value : 'Bury Checked' };
    } else if (type === 'bury-all') {
      const native = document.querySelector('input[value*="Bury Everything"], input[name="buryhoard"]');
      return { name: native ? native.name : 'buryhoard', value: native ? native.value : 'Bury Everything' };
    } else if (type === 'dig') {
      const native = document.querySelector('input[value*="Dig Up Checked"], input[value*="Dig Up"], input[name="digall"]');
      return { name: native ? native.name : 'digall', value: native ? native.value : 'Dig Up Checked' };
    } else if (type === 'dig-all') {
      const native = document.querySelector('input[value*="Dig Up Everything"], input[name="dighoard"], input[name="digeverything"]');
      return { name: native ? native.name : 'dighoard', value: native ? native.value : 'Dig Up Everything' };
    }
    return { name: 'submit', value: 'Submit' };
  }

  // =========================================================================
  // 1. DATA EXTRACTION FROM LIODEN PAGE
  // =========================================================================

  function extractCurrentAccountInfo() {
    let mid = null;
    let name = '';

    // 1. Allow URL or hash override in offline file: mode (e.g. #mid=123456 or ?mid=123456)
    if (window.location.protocol === 'file:') {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('mid')) mid = urlParams.get('mid');
      const hashMatch = window.location.hash.match(/mid=(\d+)/);
      if (hashMatch) mid = hashMatch[1];
    }

    // 2. DOM #uimid element
    if (!mid) {
      const uiMidEl = document.getElementById('uimid');
      if (uiMidEl && uiMidEl.dataset && uiMidEl.dataset.mid && uiMidEl.dataset.mid !== 'false') {
        mid = String(uiMidEl.dataset.mid).trim();
      }
    }

    // 3. Script tags in DOM (var mid = 12345 or var uid = 12345)
    if (!mid) {
      const scripts = Array.from(document.querySelectorAll('script'));
      for (const s of scripts) {
        const text = s.textContent || '';
        const match = text.match(/var\s+(?:mid|uid)\s*=\s*['"]?(\d+)['"]?/);
        if (match) {
          mid = match[1];
          break;
        }
      }
    }

    // 4. Lion profile link in DOM
    const lionLink = document.querySelector('a[href*="lion.php?mid="]');
    if (lionLink) {
      if (!mid) {
        const match = lionLink.getAttribute('href').match(/mid=(\d+)/);
        if (match) mid = match[1];
      }
      const heading = lionLink.querySelector('h3, h4, b');
      if (heading) {
        name = heading.textContent.replace('→', '').trim();
      } else {
        name = lionLink.textContent.replace('→', '').trim();
      }
    }

    return {
      mid: mid || null,
      name: name || (mid ? `Account #${mid}` : 'Default Account')
    };
  }

  function checkHasLinkedAccount() {
    // 1. Native switch account form, link, or hidden input
    if (document.querySelector('form[action*="account-link"], a[href*="account-link"], input[name="switchaccount"]')) {
      return true;
    }

    // 2. Button or submit input with "Switch Account" text
    const candidates = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a.button'));
    if (candidates.some(el => (el.textContent || el.value || '').trim().toLowerCase().includes('switch account'))) {
      return true;
    }

    // 3. Known accounts list in storage has more than 1 account recorded
    if (knownAccounts && Object.keys(knownAccounts).length > 1) {
      return true;
    }

    // 4. File protocol preview test mode with mid hash
    if (window.location.protocol === 'file:' && (window.location.hash.includes('mid=') || document.querySelector('#preview-switch-account'))) {
      return true;
    }

    return false;
  }

  function extractHoardData() {
    try {
      const scripts = Array.from(document.querySelectorAll('script'));
      const targetScript = scripts.find(s =>
        s.textContent.includes('var inventoryData = ') &&
        s.textContent.includes('var itemData = ')
      );

      if (!targetScript) {
        console.warn('[LHO] Hoard script tag not found in DOM.');
        return null;
      }

      const text = targetScript.textContent;
      const itemStart = text.indexOf('var itemData = ');
      const invStart = text.indexOf('var inventoryData = ');
      const activeStart = text.indexOf('var activeItems = ');

      if (itemStart === -1 || invStart === -1) {
        console.warn('[LHO] Variables itemData or inventoryData missing.');
        return null;
      }

      const rawItem = text.slice(itemStart + 'var itemData = '.length, invStart).trim().replace(/;$/, '');
      const rawInv = text.slice(invStart + 'var inventoryData = '.length, activeStart !== -1 ? activeStart : text.length).trim().replace(/;$/, '');

      const itemData = JSON.parse(rawItem);
      const inventoryData = JSON.parse(rawInv);

      // Decode HTML entities in item catalog
      for (const id in itemData) {
        const it = itemData[id];
        if (it.name) it.name = decodeHtml(it.name);
        if (it.nameClean) it.nameClean = decodeHtml(it.nameClean);
        if (it.description) it.description = decodeHtml(it.description);
      }

      // Pre-process items
      for (let i = 0; i < inventoryData.length; i++) {
        const inv = inventoryData[i];
        const item = itemData[inv.item];
        if (item) {
          inv.name = item.name || '';
          inv.nameClean = item.nameClean || item.name || '';
          inv.type = item.type || 'Other';
          inv.description = item.description || '';
          inv.picture = item.picture || '';
          inv.crafting = item.crafting == 1;
          inv.is_custom = (item.is_custom == 1);
        }
      }

      return { itemData, inventoryData };
    } catch (e) {
      console.error('[LHO] Error extracting hoard data:', e);
      return null;
    }
  }

  // =========================================================================
  // 2. STORAGE MANAGEMENT (Supports Linked Main & Side Accounts)
  // =========================================================================

  function getActiveAccountStorageKey() {
    if (linkedAccountsMode === 'separate' && currentMid) {
      return STORAGE_KEY + '_' + currentMid;
    }
    return STORAGE_KEY;
  }

  function applyLoadedStorage(res) {
    const settings = res[SETTINGS_KEY] || {};
    linkedAccountsMode = settings.linkedAccountsMode || 'shared';
    knownAccounts = settings.knownAccounts || {};
    activeFolderIdByAccount = settings.activeFolderIdByAccount || {};

    if (currentMid) {
      knownAccounts[currentMid] = {
        mid: currentMid,
        name: currentAccountName,
        lastSeen: Date.now()
      };
    }

    const sharedData = res[STORAGE_KEY] || {};
    let activeData = sharedData;

    if (linkedAccountsMode === 'separate' && currentMid) {
      const accountKey = STORAGE_KEY + '_' + currentMid;
      if (res[accountKey]) {
        activeData = res[accountKey];
      } else {
        // First time in separate mode for this account:
        // Clone from shared data so user doesn't lose existing folders, or use DEFAULT_FOLDERS
        if (sharedData && Array.isArray(sharedData.folders) && sharedData.folders.length > 0) {
          activeData = JSON.parse(JSON.stringify(sharedData));
        } else {
          activeData = { folders: DEFAULT_FOLDERS };
        }
      }
    }

    userFolders = activeData.folders || DEFAULT_FOLDERS;
    itemFolderMap = activeData.itemMap || {};
    instanceFolderMap = activeData.instanceMap || {};

    if (typeof settings.enabled === 'boolean') isFolderViewEnabled = settings.enabled;

    if (linkedAccountsMode === 'separate' && currentMid) {
      activeFolderId = activeFolderIdByAccount[currentMid] || activeData.activeFolderId || 'unsorted';
    } else {
      activeFolderId = settings.activeFolderId || 'unsorted';
    }

    if (settings.sortBy) sortBy = settings.sortBy;
    if (settings.pageSize) {
      let ps = settings.pageSize;
      if (ps === '50') ps = '60';
      else if (ps === '100') ps = '120';
      else if (ps === '200') ps = '240';
      pageSize = ps;
    }
    if (typeof settings.foldersCollapsed === 'boolean') isFoldersCollapsed = settings.foldersCollapsed;
    if (settings.theme) currentTheme = settings.theme;
  }

  async function loadStorageData() {
    return new Promise((resolve) => {
      const accInfo = extractCurrentAccountInfo();
      currentMid = accInfo.mid;
      currentAccountName = accInfo.name;

      const keysToGet = [STORAGE_KEY, SETTINGS_KEY];
      if (currentMid) {
        keysToGet.push(STORAGE_KEY + '_' + currentMid);
      }

      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(keysToGet, (res) => {
          applyLoadedStorage(res || {});
          resolve();
        });
      } else {
        const res = {};
        keysToGet.forEach(k => {
          const raw = localStorage.getItem(k);
          if (raw) {
            try { res[k] = JSON.parse(raw); } catch (e) {}
          }
        });
        applyLoadedStorage(res);
        resolve();
      }
    });
  }

  async function saveStorageData() {
    const isSeparate = (linkedAccountsMode === 'separate' && currentMid);
    const activeStorageKey = isSeparate ? (STORAGE_KEY + '_' + currentMid) : STORAGE_KEY;

    const data = {
      folders: userFolders,
      itemMap: itemFolderMap,
      instanceMap: instanceFolderMap,
      activeFolderId: activeFolderId,
      updatedAt: Date.now()
    };

    if (currentMid) {
      knownAccounts[currentMid] = {
        mid: currentMid,
        name: currentAccountName,
        lastSeen: Date.now()
      };
      activeFolderIdByAccount[currentMid] = activeFolderId;
    }

    const settings = {
      enabled: isFolderViewEnabled,
      activeFolderId: activeFolderId,
      activeFolderIdByAccount: activeFolderIdByAccount,
      sortBy: sortBy,
      pageSize: pageSize,
      foldersCollapsed: isFoldersCollapsed,
      theme: currentTheme,
      detectedTheme: resolvedTheme,
      linkedAccountsMode: linkedAccountsMode,
      knownAccounts: knownAccounts,
      lastActiveAccount: currentMid
    };

    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({
          [activeStorageKey]: data,
          [SETTINGS_KEY]: settings
        }, resolve);
      } else {
        localStorage.setItem(activeStorageKey, JSON.stringify(data));
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        resolve();
      }
    });
  }

  // =========================================================================
  // 3. FOLDER OPERATIONS
  // =========================================================================

  function getItemFolder(inv) {
    if (instanceFolderMap[inv.id]) return instanceFolderMap[inv.id];
    if (itemFolderMap[inv.item]) return itemFolderMap[inv.item];
    return null; // unsorted
  }

  function assignItemToFolder(itemId, instanceId, folderId, applyAllCopies = true) {
    if (folderId === 'unsorted' || folderId === null) {
      delete itemFolderMap[itemId];
      if (instanceId) delete instanceFolderMap[instanceId];
    } else {
      if (applyAllCopies) {
        itemFolderMap[itemId] = folderId;
        if (instanceId) delete instanceFolderMap[instanceId];
      } else {
        instanceFolderMap[instanceId] = folderId;
      }
    }
    saveStorageData();
  }

  function countFolderItems(folderId) {
    const invList = getCurrentInventory();
    return invList.filter(inv => {
      const f = getItemFolder(inv);
      if (folderId === 'all') return true;
      if (folderId === 'unsorted') return f === null;
      return f === folderId;
    }).length;
  }

  function getFolderInventory(folderId) {
    const invList = getCurrentInventory();
    return invList.filter(inv => {
      const f = getItemFolder(inv);
      if (folderId === 'all') return true;
      if (folderId === 'unsorted') return f === null;
      return f === folderId;
    });
  }

  function scrollActiveTabIntoView() {
    if (!isFoldersCollapsed) return;
    requestAnimationFrame(() => {
      const container = document.getElementById('lho-folder-tabs');
      const activeTab = container?.querySelector('.lho-tab.active');
      if (container && activeTab) {
        activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
    });
  }

  function toggleFolderListCollapse() {
    isFoldersCollapsed = !isFoldersCollapsed;
    saveStorageData();

    const wrapper = document.getElementById('lho-tabs-wrapper');
    const container = document.getElementById('lho-folder-tabs');
    const btn = document.getElementById('lho-btn-toggle-collapse');

    if (wrapper) wrapper.classList.toggle('is-collapsed', isFoldersCollapsed);
    if (container) container.classList.toggle('is-collapsed', isFoldersCollapsed);
    if (btn) {
      btn.title = isFoldersCollapsed ? 'Expand folder list (show all rows)' : 'Collapse folder list to 1 row';
      btn.innerHTML = `
        <span class="lho-toggle-icon">${isFoldersCollapsed ? '▼' : '▲'}</span>
        <span class="lho-toggle-label">${isFoldersCollapsed ? 'Expand' : 'Collapse'}</span>
      `;
    }

    if (isFoldersCollapsed) {
      scrollActiveTabIntoView();
    }
  }

  // =========================================================================
  // 4. UI CREATION & INJECTION
  // =========================================================================

  function initOrganizerUI() {
    // If viewing a stacked item page, do not initialize - show default Lioden stack page
    if (checkIsStackPage()) return;

    // Look for form that contains fraHoardList (must be present on hoard grid page)
    const fraHoard = document.getElementById('fraHoardList');
    if (!fraHoard) {
      console.warn('[LHO] Native hoard container #fraHoardList not found. Skipping organizer initialization.');
      return;
    }

    const hoardForm = fraHoard.closest('form');
    if (!hoardForm) {
      console.warn('[LHO] Native hoard form not found.');
      return;
    }

    // Create Root Container
    let root = document.getElementById('lioden-hoard-organizer');
    if (!root) {
      root = document.createElement('div');
      root.id = 'lioden-hoard-organizer';

      // Insert at the top of hoardForm, right before native controls
      hoardForm.insertBefore(root, hoardForm.firstChild);
    }

    // Create classic view banner placeholder
    let classicBanner = document.getElementById('lho-classic-banner');
    if (!classicBanner) {
      classicBanner = document.createElement('div');
      classicBanner.id = 'lho-classic-banner';
      classicBanner.className = 'lho-classic-banner lho-hidden';
      classicBanner.innerHTML = `
        <span>📁 <b>Lioden Hoard Organizer</b> is currently in Classic View.</span>
        <button type="button" class="lho-btn lho-btn-primary lho-btn-sm" id="lho-btn-return-folders">
          Switch to Folder View
        </button>
      `;
      hoardForm.insertBefore(classicBanner, root);

      classicBanner.querySelector('#lho-btn-return-folders').addEventListener('click', () => {
        isFolderViewEnabled = true;
        saveStorageData();
        updateViewMode();
      });
    }

    // Initialize custom tooltip
    initTooltip();

    // Global keyboard listener (ESC closes popovers and modals)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeAllPopovers();
        closeModal();
      }
    });

    // Listen for hashchange (for file: offline testing between #hoard and #buried and #stack and #mid=...)
    window.addEventListener('hashchange', async () => {
      const curRoot = document.getElementById('lioden-hoard-organizer');
      const curBanner = document.getElementById('lho-classic-banner');
      const curFraHoard = document.getElementById('fraHoardList');

      // Check if simulated account ID changed via hash (e.g. #mid=999888)
      const newAcc = extractCurrentAccountInfo();
      if (newAcc.mid && newAcc.mid !== currentMid) {
        currentMid = newAcc.mid;
        currentAccountName = newAcc.name;
        await loadStorageData();
        selectedItems.clear();
        currentPage = 1;
        renderOrganizer();
        showToast(`Switched view to Account #${currentMid} (${currentAccountName})`);
        return;
      }

      if (checkIsStackPage()) {
        if (curRoot) curRoot.classList.add('lho-hidden');
        if (curBanner) curBanner.classList.add('lho-hidden');
        if (curFraHoard) curFraHoard.classList.remove('lho-hidden');
        return;
      }

      if (isFolderViewEnabled) {
        if (curRoot) curRoot.classList.remove('lho-hidden');
        if (curFraHoard) curFraHoard.classList.add('lho-hidden');
      }

      selectedItems.clear();
      currentPage = 1;
      renderOrganizer();
    });

    // Intercept native sub_menu links and account switch in file: preview mode
    if (window.location.protocol === 'file:') {
      document.querySelectorAll('.sub_menu a').forEach(a => {
        const href = a.getAttribute('href') || '';
        if (href.includes('page=buried')) {
          a.addEventListener('click', (e) => {
            e.preventDefault();
            window.location.hash = '#buried';
          });
        } else if (href === '/hoard.php' || href.endsWith('/hoard.php')) {
          a.addEventListener('click', (e) => {
            e.preventDefault();
            window.location.hash = '#hoard';
          });
        }
      });

      const switchForm = document.querySelector('form[action*="account-link.php"]');
      if (switchForm) {
        switchForm.addEventListener('submit', (e) => {
          e.preventDefault();
          const targetMid = (currentMid === '999888') ? '583579' : '999888';
          window.location.hash = `#mid=${targetMid}`;
        });
      }
    }

    // Re-render when window is resized across responsive grid breakpoints to ensure full rows
    let lastColCount = getGridColumnCount();
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const newCols = getGridColumnCount();
        if (newCols !== lastColCount) {
          lastColCount = newCols;
          if (pageSize !== 'all') {
            renderOrganizer();
          }
        }
      }, 100);
    });

    // Apply theme (Day, Night, Desert, or Auto)
    applyTheme();

    // Render full organizer
    renderOrganizer();

    // Update view mode display
    updateViewMode();
  }

  function detectLiodenTheme() {
    // 1. Check <link rel="stylesheet"> in document head
    const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
    for (const link of links) {
      const href = (link.getAttribute('href') || '').toLowerCase();
      if (href.includes('night')) return 'night';
      if (href.includes('desert')) return 'desert';
    }

    // 2. Check CSS custom property --bg-container-color from Lioden theme stylesheets
    try {
      const rootStyle = window.getComputedStyle(document.documentElement);
      const bgContainer = (rootStyle.getPropertyValue('--bg-container-color') || '').trim().toLowerCase();
      if (bgContainer === '#8ca5a1' || bgContainer.includes('140, 165, 161') || bgContainer.includes('140,165,161')) return 'night';
      if (bgContainer === '#dec09a' || bgContainer.includes('222, 192, 154') || bgContainer.includes('222,192,154')) return 'desert';
    } catch (e) {}

    // 3. Check computed style of native Lioden header / topbar elements
    try {
      const topbar = document.querySelector('.topbar, .table .top, th.top');
      if (topbar) {
        const topbarBg = window.getComputedStyle(topbar).backgroundColor;
        if (topbarBg === 'rgb(69, 89, 90)' || topbarBg === '#45595a') return 'night';
        if (topbarBg === 'rgb(122, 90, 66)' || topbarBg === '#7a5a42') return 'desert';
        if (topbarBg === 'rgb(109, 56, 31)' || topbarBg === '#6d381f') return 'day';
      }
    } catch (e) {}

    // 4. Check body background-image
    try {
      const bodyBg = (window.getComputedStyle(document.body).backgroundImage || '').toLowerCase();
      if (bodyBg.includes('nightbg') || bodyBg.includes('night')) return 'night';
      if (bodyBg.includes('desertbg') || bodyBg.includes('desert')) return 'desert';
    } catch (e) {}

    return 'day';
  }

  function applyTheme() {
    if (currentTheme === 'auto') {
      resolvedTheme = detectLiodenTheme();
    } else {
      resolvedTheme = currentTheme;
    }

    document.documentElement.setAttribute('data-lho-theme', resolvedTheme);
    document.body.setAttribute('data-lho-theme', resolvedTheme);

    const root = document.getElementById('lioden-hoard-organizer');
    if (root) {
      root.setAttribute('data-theme', resolvedTheme);
    }
  }

  function updateViewMode() {
    const root = document.getElementById('lioden-hoard-organizer');
    const classicBanner = document.getElementById('lho-classic-banner');
    const fraHoard = document.getElementById('fraHoardList');
    const paginationTables = document.querySelectorAll('table.table.auto');
    const nativeFeatureRow = document.querySelector('.feature.b.row');

    if (isFolderViewEnabled) {
      if (root) root.classList.remove('lho-hidden');
      if (classicBanner) classicBanner.classList.add('lho-hidden');
      if (fraHoard) fraHoard.classList.add('lho-hidden');
      paginationTables.forEach(el => el.classList.add('lho-hidden'));
      if (nativeFeatureRow) nativeFeatureRow.classList.add('lho-hidden');
    } else {
      if (root) root.classList.add('lho-hidden');
      if (classicBanner) classicBanner.classList.remove('lho-hidden');
      if (fraHoard) fraHoard.classList.remove('lho-hidden');
      paginationTables.forEach(el => el.classList.remove('lho-hidden'));
      if (nativeFeatureRow) nativeFeatureRow.classList.remove('lho-hidden');
    }
  }

  // =========================================================================
  // 5. ORGANIZER RENDERING
  // =========================================================================

  function renderOrganizer() {
    const root = document.getElementById('lioden-hoard-organizer');
    if (!root || !hoardData) return;

    const isBuried = checkIsBuriedPage();
    const currentInv = getCurrentInventory();
    const totalCount = currentInv.length;
    const unsortedCount = countFolderItems('unsorted');

    const buriedUrl = window.location.protocol === 'file:' ? '#buried' : '/hoard.php?page=buried';
    const hoardUrl = window.location.protocol === 'file:' ? '#hoard' : '/hoard.php';

    const digInputInfo = getNativeInputInfo('dig');
    const digAllInputInfo = getNativeInputInfo('dig-all');
    const buryInputInfo = getNativeInputInfo('bury');

    root.innerHTML = `
      <!-- Header -->
      <div class="lho-header">
        <div class="lho-title-area">
          <span class="lho-title">${isBuried ? '⛏️ Buried Items Organizer' : '🦁 Hoard Organizer'}</span>
          <span class="lho-stats-pill">${totalCount} Items • ${userFolders.length} Folders</span>
          ${linkedAccountsMode === 'separate' && currentMid ? `
            <span class="lho-stats-pill" style="background: var(--lho-accent); color: #fff;" title="Folders specific to ${escapeHtml(currentAccountName)} (#${currentMid})">👤 #${currentMid}</span>
          ` : ''}
          ${isBuried ? '<span class="lho-stats-pill" style="background:#4A5568;color:#fff;">🪦 Buried Vault</span>' : ''}
        </div>
        <div class="lho-header-actions">
          ${isBuried ? `
            <a href="${hoardUrl}" class="lho-btn lho-btn-primary" id="lho-btn-nav-hoard" title="Return to active hoard">
              📦 Back to Hoard
            </a>
          ` : `
            <a href="${buriedUrl}" class="lho-btn lho-btn-secondary" id="lho-btn-nav-buried" title="View and dig up your buried items">
              🪦 Buried Items ↗
            </a>
          `}
          <button type="button" class="lho-btn lho-btn-primary" id="lho-btn-add-folder">
            + New Folder
          </button>
          <button type="button" class="lho-btn lho-btn-secondary" id="lho-btn-backup">
            ⚙️ Backup / Settings
          </button>
          <button type="button" class="lho-btn lho-btn-secondary" id="lho-btn-toggle-view" title="Toggle back to original view">
            📄 Classic View
          </button>
        </div>
      </div>

      <!-- Buried Mode Notice Banner -->
      ${isBuried ? `
        <div class="lho-buried-banner">
          <div class="lho-buried-banner-text">
            <span class="lho-buried-icon">⛏️</span>
            <div>
              <b>Buried Items Vault</b> — Select items and click <b>Dig Up Selected</b>, or use <b>⛏️ Dig Up All</b> to return them to your active hoard.
            </div>
          </div>
          <a href="${hoardUrl}" class="lho-btn lho-btn-secondary lho-btn-sm">← Return to Active Hoard</a>
        </div>
      ` : ''}

      <!-- Folder Navigation Tabs -->
      <div class="lho-tabs-wrapper ${isFoldersCollapsed ? 'is-collapsed' : ''}" id="lho-tabs-wrapper">
        <div class="lho-tabs-container ${isFoldersCollapsed ? 'is-collapsed' : ''}" id="lho-folder-tabs">
          <!-- Unsorted Tab (Default View) -->
          <div class="lho-tab ${activeFolderId === 'unsorted' ? 'active' : ''}" data-folder-id="unsorted" title="Default View: Unsorted items only">
            <span class="lho-tab-icon">📥</span>
            <span>Unsorted</span>
            <span class="lho-tab-count">${unsortedCount}</span>
          </div>

          <!-- Custom User Folders -->
          ${userFolders.map(folder => {
            const count = countFolderItems(folder.id);
            return `
              <div class="lho-tab user-folder-tab ${activeFolderId === folder.id ? 'active' : ''}"
                   draggable="true"
                   data-folder-id="${folder.id}"
                   title="Drag to reorder folder or click to open">
                <span class="lho-tab-dot" style="background: ${folder.color};"></span>
                <span class="lho-tab-icon">${folder.icon || '📁'}</span>
                <span>${escapeHtml(folder.name)}</span>
                <span class="lho-tab-count">${count}</span>
                <span class="lho-tab-menu-btn" data-action="folder-menu" title="Folder actions">⋮</span>
              </div>
            `;
          }).join('')}

          <!-- All Items Tab -->
          <div class="lho-tab ${activeFolderId === 'all' ? 'active' : ''}" data-folder-id="all" title="View all items in hoard including organized items">
            <span class="lho-tab-icon">📦</span>
            <span>All Items</span>
            <span class="lho-tab-count">${totalCount}</span>
          </div>

          <!-- Sort Folders Button (if 2+ folders) -->
          ${userFolders.length >= 2 ? `
            <div class="lho-tab lho-tab-action" id="lho-btn-sort-folders" title="Sort folders alphabetically or by size">
              <span>⇅ Sort Folders ▾</span>
            </div>
          ` : ''}
        </div>

        ${userFolders.length > 0 ? `
          <div class="lho-tabs-toggle-wrap">
            <button type="button" class="lho-tabs-toggle-btn" id="lho-btn-toggle-collapse" title="${isFoldersCollapsed ? 'Expand folder list (show all rows)' : 'Collapse folder list to 1 row'}">
              <span class="lho-toggle-icon">${isFoldersCollapsed ? '▼' : '▲'}</span>
              <span class="lho-toggle-label">${isFoldersCollapsed ? 'Expand' : 'Collapse'}</span>
            </button>
          </div>
        ` : ''}
      </div>

      <!-- Active Folder Banner (if viewing custom folder) -->
      ${renderFolderBanner()}

      <!-- Toolbar & Filters -->
      <div class="lho-toolbar">
        <div class="lho-filter-group">
          <!-- Search -->
          <div class="lho-input-wrapper">
            <span class="lho-search-icon">🔍</span>
            <input type="text" class="lho-search-input" id="lho-search-input" placeholder="Search items..." value="${escapeHtml(searchQuery)}">
            <span class="lho-search-clear" id="lho-search-clear" style="display: ${searchQuery ? 'block' : 'none'};">&times;</span>
          </div>

          <!-- Category Filter -->
          <select class="lho-select" id="lho-category-select">
            <option value="all" ${categoryFilter === 'all' ? 'selected' : ''}>All Categories</option>
            <option value="Amusement" ${categoryFilter === 'Amusement' ? 'selected' : ''}>Amusement</option>
            <option value="Applicator" ${categoryFilter === 'Applicator' ? 'selected' : ''}>Applicator</option>
            <option value="Background" ${categoryFilter === 'Background' ? 'selected' : ''}>Background</option>
            <option value="Beetle Skin" ${categoryFilter === 'Beetle Skin' ? 'selected' : ''}>Beetle Skin</option>
            <option value="Craftable" ${categoryFilter === 'Craftable' ? 'selected' : ''}>Craftable</option>
            <option value="Custom Decoration" ${categoryFilter === 'Custom Decoration' ? 'selected' : ''}>Custom Decoration</option>
            <option value="Decoration" ${categoryFilter === 'Decoration' ? 'selected' : ''}>Decoration</option>
            <option value="Food" ${categoryFilter === 'Food' ? 'selected' : ''}>Food</option>
            <option value="Other" ${categoryFilter === 'Other' ? 'selected' : ''}>Other</option>
            <option value="Special Use" ${categoryFilter === 'Special Use' ? 'selected' : ''}>Special Use</option>
          </select>

          <!-- Sort Order -->
          <select class="lho-select" id="lho-sort-select">
            <option value="name_asc" ${sortBy === 'name_asc' ? 'selected' : ''}>Name (A → Z)</option>
            <option value="name_desc" ${sortBy === 'name_desc' ? 'selected' : ''}>Name (Z → A)</option>
            <option value="uses_desc" ${sortBy === 'uses_desc' ? 'selected' : ''}>Uses (Most → Least)</option>
            <option value="uses_asc" ${sortBy === 'uses_asc' ? 'selected' : ''}>Uses (Least → Most)</option>
            <option value="amount_desc" ${sortBy === 'amount_desc' ? 'selected' : ''}>Stack Quantity</option>
            <option value="rotting_asc" ${sortBy === 'rotting_asc' ? 'selected' : ''}>Expiring Soonest</option>
          </select>
        </div>

        <div class="lho-filter-group">
          <!-- Theme -->
          <span style="font-size: 11px; color: var(--lho-text-muted);">Theme:</span>
          <select class="lho-select" id="lho-theme-select" title="Color Theme (Auto detects Lioden's Day, Night, or Desert theme)">
            <option value="auto" ${currentTheme === 'auto' ? 'selected' : ''}>Auto (${resolvedTheme ? (resolvedTheme.charAt(0).toUpperCase() + resolvedTheme.slice(1)) : 'Site'})</option>
            <option value="day" ${currentTheme === 'day' ? 'selected' : ''}>Day Mode</option>
            <option value="night" ${currentTheme === 'night' ? 'selected' : ''}>Night Mode</option>
            <option value="desert" ${currentTheme === 'desert' ? 'selected' : ''}>Desert Mode</option>
          </select>

          <!-- Page Limit -->
          <span style="font-size: 11px; color: var(--lho-text-muted);">Display:</span>
          <select class="lho-select" id="lho-pagesize-select" title="Items per page (evenly fills grid rows)">
            <option value="all" ${pageSize === 'all' ? 'selected' : ''}>All (Aggregated)</option>
            <option value="60" ${pageSize === '60' ? 'selected' : ''}>60 per page</option>
            <option value="120" ${pageSize === '120' ? 'selected' : ''}>120 per page</option>
            <option value="240" ${pageSize === '240' ? 'selected' : ''}>240 per page</option>
          </select>
        </div>
      </div>

      <!-- Multi-select Bulk Actions Bar -->
      <div class="lho-bulk-bar" id="lho-bulk-bar">
        <div style="font-weight: bold; font-size: 12px; color: var(--lho-primary);">
          ✓ <span id="lho-selected-count">0</span> items selected
        </div>
        <div class="lho-bulk-actions">
          <button type="button" class="lho-btn lho-btn-outline lho-btn-sm" id="lho-btn-select-all">Select All Visible</button>
          <button type="button" class="lho-btn lho-btn-outline lho-btn-sm" id="lho-btn-deselect-all">Deselect All</button>

          <span style="color: var(--lho-border-dark);">|</span>

          <span>Move to:</span>
          <select class="lho-select" id="lho-bulk-folder-select">
            <option value="">-- Choose Folder --</option>
            <option value="unsorted">📥 Move to Unsorted</option>
            ${userFolders.map(f => `<option value="${f.id}">${f.icon || '📁'} ${escapeHtml(f.name)}</option>`).join('')}
          </select>
          <button type="button" class="lho-btn lho-btn-primary lho-btn-sm" id="lho-btn-bulk-move">Move</button>

          <span style="color: var(--lho-border-dark);">|</span>

          ${isBuried ? `
            <!-- Native Dig Up Action Integration -->
            <input type="submit" name="${digInputInfo.name}" value="${digInputInfo.value}" class="lho-btn lho-btn-primary lho-btn-sm" id="lho-btn-bulk-dig" onclick="return confirm('Are you sure you want to dig up these selected items?');">
            <input type="submit" name="${digAllInputInfo.name}" value="${digAllInputInfo.value}" class="lho-btn lho-btn-outline lho-btn-sm" id="lho-btn-bulk-dig-all" onclick="return confirm('Are you sure you want to dig up everything in your buried hoard?');">
          ` : `
            <!-- Native Bury Action Integration -->
            <input type="submit" name="${buryInputInfo.name}" value="${buryInputInfo.value}" class="lho-btn lho-btn-danger lho-btn-sm" id="lho-btn-bulk-bury" onclick="return confirm('Are you sure you want to bury these selected items?');">
            <!-- Branch Action -->
            <button type="button" class="lho-btn lho-btn-outline lho-btn-sm" id="lho-btn-bulk-branch" title="Put selected items on your branch">🌿 Branch Selected</button>
          `}
        </div>
      </div>

      <!-- Top Pagination Bar -->
      <div class="lho-pagination-bar lho-pagination-bar-top" id="lho-pagination-bar-top">
        <!-- Pagination controls injected here -->
      </div>

      <!-- Items Section -->
      <div class="lho-items-section">
        <div class="lho-grid" id="lho-items-grid">
          <!-- Items injected here -->
        </div>
      </div>

      <!-- Pagination Bar -->
      <div class="lho-pagination-bar" id="lho-pagination-bar">
        <!-- Pagination controls injected here -->
      </div>
    `;

    attachOrganizerEvents();
    renderItemsGrid();
    scrollActiveTabIntoView();
  }

  function renderFolderBanner() {
    if (activeFolderId === 'all' || activeFolderId === 'unsorted') return '';

    const folder = userFolders.find(f => f.id === activeFolderId);
    if (!folder) return '';

    const count = countFolderItems(folder.id);
    const isBuried = checkIsBuriedPage();

    return `
      <div class="lho-folder-banner">
        <div class="lho-folder-info">
          <span class="lho-tab-dot" style="background: ${folder.color}; width: 14px; height: 14px;"></span>
          <span class="lho-folder-name-lg">${folder.icon || '📁'} ${escapeHtml(folder.name)}</span>
          <span class="lho-stats-pill" style="background: #E0D4C1; color: var(--lho-text);">${count} items</span>
        </div>
        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
          <button type="button" class="lho-btn lho-btn-outline lho-btn-sm" id="lho-btn-edit-folder" data-id="${folder.id}">
            ✏️ Edit
          </button>
          ${isBuried ? `
            <button type="button" class="lho-btn lho-btn-primary lho-btn-sm" id="lho-btn-dig-folder" data-id="${folder.id}" title="Dig up all items in this folder">
              ⛏️ Dig Up All
            </button>
          ` : `
            <button type="button" class="lho-btn lho-btn-outline lho-btn-sm" id="lho-btn-bury-folder" data-id="${folder.id}" title="Bury all items in this folder">
              🪦 Bury All
            </button>
            <button type="button" class="lho-btn lho-btn-outline lho-btn-sm" id="lho-btn-branch-folder" data-id="${folder.id}" title="Put all items in this folder on your branch">
              🌿 Put on Branch
            </button>
          `}
          <button type="button" class="lho-btn lho-btn-danger lho-btn-sm" id="lho-btn-delete-folder" data-id="${folder.id}">
            🗑️ Delete
          </button>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // 6. ITEMS FILTERING, SORTING & RENDERING
  // =========================================================================

  function getFilteredItems() {
    const invList = getCurrentInventory();
    if (!invList || invList.length === 0) return [];

    let items = invList.filter(inv => {
      const folder = getItemFolder(inv);

      // Folder Filter
      if (activeFolderId === 'unsorted') {
        if (folder !== null) return false;
      } else if (activeFolderId !== 'all') {
        if (folder !== activeFolderId) return false;
      }

      // Search Query (searches item titles only)
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesName = (inv.name && inv.name.toLowerCase().includes(q)) ||
                            (inv.nameClean && inv.nameClean.toLowerCase().includes(q));
        if (!matchesName) return false;
      }

      // Category Filter
      if (categoryFilter !== 'all') {
        if (categoryFilter === 'Craftable') {
          if (!inv.crafting) return false;
        } else if (categoryFilter === 'Custom Decoration') {
          if (!(inv.type === 'Decoration' && inv.is_custom)) return false;
        } else if (categoryFilter === 'Decoration') {
          if (!(inv.type === 'Decoration' && !inv.is_custom)) return false;
        } else {
          if (inv.type !== categoryFilter) return false;
        }
      }

      return true;
    });

    // Sorting
    items.sort((a, b) => {
      if (sortBy === 'name_asc') {
        return (a.nameClean || a.name || '').localeCompare(b.nameClean || b.name || '');
      } else if (sortBy === 'name_desc') {
        return (b.nameClean || b.name || '').localeCompare(a.nameClean || a.name || '');
      } else if (sortBy === 'uses_desc') {
        return (b.totaluses || 0) - (a.totaluses || 0);
      } else if (sortBy === 'uses_asc') {
        return (a.totaluses || 0) - (b.totaluses || 0);
      } else if (sortBy === 'amount_desc') {
        return (b.amount || 0) - (a.amount || 0);
      } else if (sortBy === 'rotting_asc') {
        const rA = parseInt(a.rotting) || 999;
        const rB = parseInt(b.rotting) || 999;
        return rA - rB;
      }
      return 0;
    });

    return items;
  }

  function getGridColumnCount() {
    const grid = document.getElementById('lho-items-grid');
    if (grid) {
      const gridStyle = window.getComputedStyle(grid);
      const templateColumns = gridStyle.getPropertyValue('grid-template-columns');
      if (templateColumns && templateColumns !== 'none') {
        const cols = templateColumns.split(' ').filter(Boolean).length;
        if (cols > 0) return cols;
      }
    }
    const width = window.innerWidth;
    if (width <= 480) return 2;
    if (width <= 768) return 3;
    if (width <= 991) return 4;
    if (width <= 1199) return 5;
    return 6;
  }

  function getEffectivePageLimit() {
    if (pageSize === 'all') return 'all';
    let base = parseInt(pageSize, 10);
    if (isNaN(base) || base <= 0) base = 60;
    if (base === 50) base = 60;
    if (base === 100) base = 120;
    if (base === 200) base = 240;

    const cols = getGridColumnCount();
    const rows = Math.max(1, Math.round(base / cols));
    return rows * cols;
  }

  function renderItemsGrid() {
    const grid = document.getElementById('lho-items-grid');
    const paginationBars = [
      document.getElementById('lho-pagination-bar-top'),
      document.getElementById('lho-pagination-bar')
    ].filter(Boolean);
    if (!grid) return;

    const isBuried = checkIsBuriedPage();
    const filtered = getFilteredItems();

    // Pagination calculations (ensuring full rows with no trailing gaps)
    const effectiveLimit = getEffectivePageLimit();
    const limit = effectiveLimit === 'all' ? filtered.length : effectiveLimit;
    const totalPages = Math.max(1, Math.ceil(filtered.length / limit));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIdx = (currentPage - 1) * limit;
    const visibleItems = filtered.slice(startIdx, startIdx + limit);

    if (visibleItems.length === 0) {
      grid.innerHTML = `
        <div class="lho-empty-state" style="grid-column: 1 / -1;">
          <div class="lho-empty-icon">${isBuried ? '⛏️' : '📦'}</div>
          <div class="lho-empty-title">${isBuried ? 'No buried items found' : 'No items found'}</div>
          <div class="lho-empty-desc">
            ${searchQuery || categoryFilter !== 'all'
              ? 'No items match your current search or category filter.'
              : isBuried
                ? (activeFolderId === 'unsorted' && countFolderItems('all') > 0
                    ? 'All buried items have been organized into folders!'
                    : 'You currently have no buried items.')
                : activeFolderId === 'unsorted'
                  ? 'All items in your hoard have been organized into folders!'
                  : 'This folder is empty. Drag and drop items here, or use the folder menu (📁▾) on any item card.'}
          </div>
        </div>
      `;
      paginationBars.forEach(b => {
        b.innerHTML = '';
        b.style.display = 'none';
      });
      return;
    }

    grid.innerHTML = visibleItems.map(inv => renderItemCard(inv)).join('');

    attachCardEvents(grid);
    renderPaginationControls(filtered.length, totalPages, startIdx, visibleItems.length);
    updateBulkBar();
  }

  function renderItemCard(inv) {
    const isStacked = inv.amount > 1;
    const isChecked = selectedItems.has(String(isStacked ? inv.item : inv.id));

    // Expiration text
    let expireHtml = '';
    if (inv.type === 'Food' && inv.rotting > 1 && inv.amount <= 1 && inv.item != 294) {
      expireHtml = `<div>Expires in ${inv.rotting} days</div>`;
    } else if (inv.type === 'Food' && inv.rotting == 1 && inv.amount <= 1 && inv.item != 294) {
      expireHtml = `<div class="lho-meta-expire">Expires tomorrow</div>`;
    }

    // Total uses / stacked text
    let usesHtml = '';
    if (isStacked) {
      usesHtml = `<div class="lho-meta-uses">${inv.totaluses} total uses</div>`;
    } else if (inv.amount === 1 && inv.item === 1439) {
      usesHtml = `<div class="lho-meta-uses">${inv.numitems || 0} in bag</div>`;
    }

    // Action link & text
    const isFileProto = window.location.protocol === 'file:';
    const useUrl = isStacked
      ? (isFileProto ? `https://www.lioden.com/hoard.php?stack=${inv.item}` : `/hoard.php?stack=${inv.item}`)
      : (isFileProto ? `https://www.lioden.com/use.php?id=${inv.id}` : `/use.php?id=${inv.id}`);
    const useText = isStacked ? `${inv.amount} Stacked` : `${inv.totaluses} ${inv.totaluses === 1 ? 'use' : 'uses'}`;
    const linkTarget = isFileProto ? ' target="_blank" rel="noopener noreferrer"' : '';

    // Item image URL
    let imgUrl = inv.picture || '';
    if (imgUrl && !imgUrl.startsWith('http')) {
      imgUrl = `${URL_STATIC}${imgUrl}`;
    }

    // Folder badge (if in All Items view)
    let folderTagHtml = '';
    if (activeFolderId === 'all') {
      const folderId = getItemFolder(inv);
      if (folderId) {
        const folder = userFolders.find(f => f.id === folderId);
        if (folder) {
          folderTagHtml = `
            <span class="lho-card-folder-tag" style="background: ${folder.color}22; color: ${folder.color}; border: 1px solid ${folder.color}44;">
              ${folder.icon || '📁'} ${escapeHtml(folder.name)}
            </span>
          `;
        }
      }
    }

    // Checkbox input name and value for native form submission
    const checkName = isStacked ? 'stack[]' : 'item[]';
    const checkValue = isStacked ? inv.item : inv.id;

    return `
      <div class="lho-card ${isChecked ? 'selected' : ''}"
           draggable="true"
           data-item-id="${inv.item}"
           data-id="${inv.id}"
           data-check-value="${checkValue}"
           data-name="${escapeHtml(inv.name)}"
           data-clean-name="${escapeHtml(inv.nameClean)}"
           data-description="${escapeHtml(inv.description)}">

        <!-- Header -->
        <div class="lho-card-header" title="${escapeHtml(inv.name)}">
          ${escapeHtml(inv.name)}
        </div>

        <!-- Image & Tooltip trigger -->
        <div class="lho-card-img-wrap">
          <a href="${useUrl}"${linkTarget}>
            <img src="${imgUrl}" alt="${escapeHtml(inv.name)}" class="lho-card-img" loading="lazy">
          </a>
        </div>

        <!-- Meta -->
        <div class="lho-card-meta">
          ${expireHtml}
          ${usesHtml}
          ${folderTagHtml}
        </div>

        <!-- Footer -->
        <div class="lho-card-footer">
          <input type="checkbox" name="${checkName}" value="${checkValue}" class="lho-card-check" ${isChecked ? 'checked' : ''}>
          <a href="${useUrl}" class="lho-card-link"${linkTarget}>${useText}</a>
          <button type="button" class="lho-card-folder-btn" title="Move to folder" data-action="quick-folder">
            📁▾
          </button>
        </div>
      </div>
    `;
  }

  function renderPaginationControls(totalResults, totalPages, startIdx, pageCount) {
    const bars = [
      document.getElementById('lho-pagination-bar-top'),
      document.getElementById('lho-pagination-bar')
    ].filter(Boolean);
    if (bars.length === 0) return;

    if (pageSize === 'all' || totalPages <= 1) {
      bars.forEach(bar => {
        bar.style.display = totalResults > 0 ? 'flex' : 'none';
        bar.innerHTML = `
          <span style="color: var(--lho-text-muted);">Showing all <b>${totalResults}</b> items</span>
        `;
      });
      return;
    }

    let pagesHtml = '';
    const maxButtons = 7;
    let startP = Math.max(1, currentPage - 3);
    let endP = Math.min(totalPages, startP + maxButtons - 1);
    if (endP - startP < maxButtons - 1) {
      startP = Math.max(1, endP - maxButtons + 1);
    }

    if (currentPage > 1) {
      pagesHtml += `<button type="button" class="lho-page-btn" data-page="${currentPage - 1}">« Prev</button>`;
    }

    for (let p = startP; p <= endP; p++) {
      pagesHtml += `
        <button type="button" class="lho-page-btn ${p === currentPage ? 'active' : ''}" data-page="${p}">
          ${p}
        </button>
      `;
    }

    if (currentPage < totalPages) {
      pagesHtml += `<button type="button" class="lho-page-btn" data-page="${currentPage + 1}">Next »</button>`;
    }

    bars.forEach(bar => {
      bar.style.display = 'flex';
      bar.innerHTML = `
        <span style="color: var(--lho-text-muted);">
          Showing <b>${startIdx + 1}–${startIdx + pageCount}</b> of <b>${totalResults}</b> items
        </span>
        <div class="lho-page-nav">
          ${pagesHtml}
        </div>
      `;

      bar.querySelectorAll('.lho-page-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const p = parseInt(btn.dataset.page, 10);
          if (p && p !== currentPage) {
            currentPage = p;
            renderItemsGrid();
            document.getElementById('lioden-hoard-organizer').scrollIntoView({ behavior: 'smooth' });
          }
        });
      });
    });
  }

  // =========================================================================
  // 7. EVENT HANDLERS & INTERACTIVITY
  // =========================================================================

  function attachOrganizerEvents() {
    const root = document.getElementById('lioden-hoard-organizer');
    if (!root) return;

    // Folder Tabs Click & Drag-and-Drop Target
    const tabsContainer = root.querySelector('#lho-folder-tabs');
    if (tabsContainer) {
      // Sort Folders Button Click
      const btnSortFolders = tabsContainer.querySelector('#lho-btn-sort-folders');
      if (btnSortFolders) {
        btnSortFolders.addEventListener('click', (e) => {
          e.stopPropagation();
          showFolderSortMenu(btnSortFolders);
        });
      }

      tabsContainer.querySelectorAll('.lho-tab').forEach(tab => {
        const folderId = tab.dataset.folderId;
        if (!folderId) return; // e.g. sort button

        tab.addEventListener('click', (e) => {
          if (e.target.dataset.action === 'folder-menu') {
            showFolderActionsMenu(folderId, e.target);
            e.stopPropagation();
            return;
          }
          if (activeFolderId !== folderId) {
            activeFolderId = folderId;
            currentPage = 1;
            selectedItems.clear();
            saveStorageData();
            renderOrganizer();
          }
        });

        // Folder Drag-to-Reorder start
        if (tab.classList.contains('user-folder-tab')) {
          tab.addEventListener('dragstart', (e) => {
            if (e.target.dataset.action === 'folder-menu') {
              e.preventDefault();
              return;
            }
            draggingFolderId = folderId;
            tab.classList.add('folder-dragging');
            e.dataTransfer.setData('application/x-lho-folder', folderId);
            e.dataTransfer.setData('text/plain', folderId);
            e.dataTransfer.effectAllowed = 'move';
          });

          tab.addEventListener('dragend', () => {
            draggingFolderId = null;
            tab.classList.remove('folder-dragging');
            tabsContainer.querySelectorAll('.lho-tab').forEach(t => {
              t.classList.remove('drag-over', 'drag-reorder-left', 'drag-reorder-right');
            });
          });
        }

        // HTML5 Drag and Drop Target (supports both Item Drop and Folder Reordering)
        tab.addEventListener('dragover', (e) => {
          e.preventDefault();
          if (draggingFolderId) {
            if (folderId !== 'all' && folderId !== 'unsorted' && folderId !== draggingFolderId) {
              e.dataTransfer.dropEffect = 'move';
              const rect = tab.getBoundingClientRect();
              const midpoint = rect.left + rect.width / 2;
              if (e.clientX < midpoint) {
                tab.classList.add('drag-reorder-left');
                tab.classList.remove('drag-reorder-right');
              } else {
                tab.classList.add('drag-reorder-right');
                tab.classList.remove('drag-reorder-left');
              }
            }
          } else {
            e.dataTransfer.dropEffect = 'move';
            tab.classList.add('drag-over');
          }
        });

        tab.addEventListener('dragleave', () => {
          tab.classList.remove('drag-over', 'drag-reorder-left', 'drag-reorder-right');
        });

        tab.addEventListener('drop', (e) => {
          e.preventDefault();
          tab.classList.remove('drag-over', 'drag-reorder-left', 'drag-reorder-right');

          // 1. Folder Reordering Drop
          if (draggingFolderId) {
            const fromId = draggingFolderId;
            draggingFolderId = null;
            if (fromId && fromId !== folderId && folderId !== 'all' && folderId !== 'unsorted') {
              const fromIndex = userFolders.findIndex(f => f.id === fromId);
              const toIndex = userFolders.findIndex(f => f.id === folderId);
              if (fromIndex !== -1 && toIndex !== -1) {
                const rect = tab.getBoundingClientRect();
                const midpoint = rect.left + rect.width / 2;
                const insertBefore = e.clientX < midpoint;

                const [moved] = userFolders.splice(fromIndex, 1);
                let targetIndex = userFolders.findIndex(f => f.id === folderId);
                if (!insertBefore) targetIndex += 1;
                userFolders.splice(targetIndex, 0, moved);

                saveStorageData();
                showToast(`Moved "${moved.name}" folder!`);
                renderOrganizer();
              }
            }
            return;
          }

          // 2. Item Drop into Folder
          try {
            const dragData = JSON.parse(e.dataTransfer.getData('text/plain'));
            const targetFolderId = folderId === 'all' ? null : folderId;
            const targetFolderName = folderId === 'unsorted' ? 'Unsorted' : (userFolders.find(f => f.id === folderId)?.name || 'Folder');

            if (dragData.checkValue && selectedItems.has(dragData.checkValue) && selectedItems.size > 1) {
              let movedCount = 0;
              getCurrentInventory().forEach(inv => {
                const val = String(inv.amount > 1 ? inv.item : inv.id);
                if (selectedItems.has(val)) {
                  assignItemToFolder(inv.item, inv.id, targetFolderId);
                  movedCount++;
                }
              });
              selectedItems.clear();
              showToast(`Moved ${movedCount} selected items to ${targetFolderName}!`);
            } else if (dragData && dragData.itemId) {
              assignItemToFolder(dragData.itemId, dragData.id, targetFolderId);
              showToast(`Moved "${dragData.name || 'Item'}" to ${targetFolderName}!`);
            }
            renderOrganizer();
          } catch (err) {
            console.error('[LHO] Drop error:', err);
          }
        });
      });

      // Horizontal Mouse Wheel Scroll for Collapsed Tabs Row
      tabsContainer.addEventListener('wheel', (e) => {
        if (!isFoldersCollapsed) return;
        if (e.deltaY !== 0 && e.deltaX === 0) {
          e.preventDefault();
          tabsContainer.scrollLeft += e.deltaY;
        }
      }, { passive: false });
    }

    // Folder List Collapse Toggle
    const btnToggleCollapse = root.querySelector('#lho-btn-toggle-collapse');
    if (btnToggleCollapse) {
      btnToggleCollapse.addEventListener('click', () => {
        toggleFolderListCollapse();
      });
    }

    // Add Folder Button
    const btnAdd = root.querySelector('#lho-btn-add-folder');
    if (btnAdd) {
      btnAdd.addEventListener('click', () => showFolderModal());
    }

    // Backup / Settings Button
    const btnBackup = root.querySelector('#lho-btn-backup');
    if (btnBackup) {
      btnBackup.addEventListener('click', () => showSettingsModal());
    }

    // View Mode Toggle
    const btnToggle = root.querySelector('#lho-btn-toggle-view');
    if (btnToggle) {
      btnToggle.addEventListener('click', () => {
        isFolderViewEnabled = false;
        saveStorageData();
        updateViewMode();
        showToast('Switched to Classic View. Click banner to return.');
      });
    }

    // Search Input
    const searchInput = root.querySelector('#lho-search-input');
    const searchClear = root.querySelector('#lho-search-clear');
    if (searchInput) {
      let searchTimeout = null;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          searchQuery = e.target.value.trim();
          currentPage = 1;
          if (searchClear) searchClear.style.display = searchQuery ? 'block' : 'none';
          renderItemsGrid();
        }, 150);
      });
    }
    if (searchClear) {
      searchClear.addEventListener('click', () => {
        searchQuery = '';
        if (searchInput) searchInput.value = '';
        searchClear.style.display = 'none';
        currentPage = 1;
        renderItemsGrid();
      });
    }

    // Category Select
    const categorySelect = root.querySelector('#lho-category-select');
    if (categorySelect) {
      categorySelect.addEventListener('change', (e) => {
        categoryFilter = e.target.value;
        currentPage = 1;
        renderItemsGrid();
      });
    }

    // Sort Select
    const sortSelect = root.querySelector('#lho-sort-select');
    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        sortBy = e.target.value;
        saveStorageData();
        renderItemsGrid();
      });
    }

    // Theme Select
    const themeSelect = root.querySelector('#lho-theme-select');
    if (themeSelect) {
      themeSelect.addEventListener('change', (e) => {
        currentTheme = e.target.value;
        applyTheme();
        saveStorageData();
        renderOrganizer();
        const displayThemeName = currentTheme === 'auto' ? `Auto (${resolvedTheme})` : (currentTheme.charAt(0).toUpperCase() + currentTheme.slice(1));
        showToast(`Theme updated to ${displayThemeName}`);
      });
    }

    // Page Size Select
    const pageSizeSelect = root.querySelector('#lho-pagesize-select');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', (e) => {
        pageSize = e.target.value;
        currentPage = 1;
        saveStorageData();
        renderItemsGrid();
      });
    }

    // Bulk Bar Actions
    const btnSelectAll = root.querySelector('#lho-btn-select-all');
    const btnDeselectAll = root.querySelector('#lho-btn-deselect-all');
    const btnBulkMove = root.querySelector('#lho-btn-bulk-move');
    const bulkFolderSelect = root.querySelector('#lho-bulk-folder-select');

    if (btnSelectAll) {
      btnSelectAll.addEventListener('click', () => {
        const visible = getFilteredItems();
        visible.forEach(inv => {
          const val = String(inv.amount > 1 ? inv.item : inv.id);
          selectedItems.add(val);
        });
        renderItemsGrid();
      });
    }

    if (btnDeselectAll) {
      btnDeselectAll.addEventListener('click', () => {
        selectedItems.clear();
        renderItemsGrid();
      });
    }

    if (btnBulkMove && bulkFolderSelect) {
      btnBulkMove.addEventListener('click', () => {
        const targetFolder = bulkFolderSelect.value;
        if (!targetFolder) {
          alert('Please choose a folder to move items into.');
          return;
        }

        const count = selectedItems.size;
        if (count === 0) return;

        getCurrentInventory().forEach(inv => {
          const val = String(inv.amount > 1 ? inv.item : inv.id);
          if (selectedItems.has(val)) {
            assignItemToFolder(inv.item, inv.id, targetFolder === 'unsorted' ? null : targetFolder);
          }
        });

        selectedItems.clear();
        const targetName = targetFolder === 'unsorted' ? 'Unsorted' : (userFolders.find(f => f.id === targetFolder)?.name || 'Folder');
        showToast(`Moved ${count} items to ${targetName}!`);
        renderOrganizer();
      });
    }

    const btnBulkBranch = root.querySelector('#lho-btn-bulk-branch');
    if (btnBulkBranch) {
      btnBulkBranch.addEventListener('click', () => {
        if (selectedItems.size === 0) return;
        const itemsToBranch = [];
        getCurrentInventory().forEach(inv => {
          const val = String(inv.amount > 1 ? inv.item : inv.id);
          if (selectedItems.has(val)) {
            itemsToBranch.push(inv);
          }
        });
        const count = itemsToBranch.length;
        if (count === 0) return;
        if (confirm(`Put ${count} selected item${count === 1 ? '' : 's'} on your Branch?`)) {
          if (window.location.protocol === 'file:') {
            showToast(`[Preview] Put ${count} selected items on Branch!`);
            selectedItems.clear();
            renderOrganizer();
            return;
          }
          submitItemsToBranch(itemsToBranch, 'Selected Items');
        }
      });
    }

    // Bulk Dig / Bury Handlers for simulated file: protocol
    const btnBulkDig = root.querySelector('#lho-btn-bulk-dig');
    const btnBulkDigAll = root.querySelector('#lho-btn-bulk-dig-all');
    const btnBulkBury = root.querySelector('#lho-btn-bulk-bury');

    if (window.location.protocol === 'file:') {
      if (btnBulkDig) {
        btnBulkDig.addEventListener('click', (e) => {
          e.preventDefault();
          const itemsToDig = getCurrentInventory().filter(inv => {
            const val = String(inv.amount > 1 ? inv.item : inv.id);
            return selectedItems.has(val);
          });
          digItems(itemsToDig, 'Selected Items');
        });
      }
      if (btnBulkDigAll) {
        btnBulkDigAll.addEventListener('click', (e) => {
          e.preventDefault();
          digAllItems();
        });
      }
      if (btnBulkBury) {
        btnBulkBury.addEventListener('click', (e) => {
          e.preventDefault();
          const itemsToBury = getCurrentInventory().filter(inv => {
            const val = String(inv.amount > 1 ? inv.item : inv.id);
            return selectedItems.has(val);
          });
          buryItems(itemsToBury, 'Selected Items');
        });
      }
    }

    // Native Form submit sync for multi-page selections
    const fraHoard = document.getElementById('fraHoardList');
    const hoardForm = fraHoard ? fraHoard.closest('form') : document.querySelector('form[method="post"]');
    if (hoardForm && !hoardForm.__lho_sync_attached__) {
      hoardForm.__lho_sync_attached__ = true;
      hoardForm.addEventListener('submit', () => {
        syncSelectedItemsToForm(hoardForm);
      });
    }

    // Folder Banner Actions (Edit / Dig / Bury / Branch / Delete)
    const btnEditFolder = root.querySelector('#lho-btn-edit-folder');
    const btnDigFolder = root.querySelector('#lho-btn-dig-folder');
    const btnBuryFolder = root.querySelector('#lho-btn-bury-folder');
    const btnBranchFolder = root.querySelector('#lho-btn-branch-folder');
    const btnDeleteFolder = root.querySelector('#lho-btn-delete-folder');

    if (btnEditFolder) {
      btnEditFolder.addEventListener('click', () => {
        const folder = userFolders.find(f => f.id === btnEditFolder.dataset.id);
        if (folder) showFolderModal(folder);
      });
    }
    if (btnDigFolder) {
      btnDigFolder.addEventListener('click', () => {
        digFolderItems(btnDigFolder.dataset.id);
      });
    }
    if (btnBuryFolder) {
      btnBuryFolder.addEventListener('click', () => {
        buryFolderItems(btnBuryFolder.dataset.id);
      });
    }
    if (btnBranchFolder) {
      btnBranchFolder.addEventListener('click', () => {
        putFolderOnBranch(btnBranchFolder.dataset.id);
      });
    }
    if (btnDeleteFolder) {
      btnDeleteFolder.addEventListener('click', () => {
        const folder = userFolders.find(f => f.id === btnDeleteFolder.dataset.id);
        if (folder && confirm(`Delete folder "${folder.name}"? All items in it will be moved to Unsorted.`)) {
          deleteFolder(folder.id);
        }
      });
    }
  }

  function attachCardEvents(grid) {
    grid.querySelectorAll('.lho-card').forEach(card => {
      const itemId = card.dataset.itemId;
      const instanceId = card.dataset.id;
      const itemName = card.dataset.name;
      const checkVal = card.dataset.checkValue;
      const checkbox = card.querySelector('.lho-card-check');

      // 1. Drag Start
      card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        const dragPayload = { id: instanceId, itemId: itemId, name: itemName, checkValue: checkVal };
        e.dataTransfer.setData('text/plain', JSON.stringify(dragPayload));
        e.dataTransfer.effectAllowed = 'move';
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
      });

      // 2. Card Background Click Selection
      card.addEventListener('click', (e) => {
        // If clicked directly on link, button, or checkbox, let native handler fire
        if (e.target.closest('a') || e.target.closest('button') || e.target.closest('input')) return;

        if (checkbox) {
          checkbox.checked = !checkbox.checked;
          checkbox.dispatchEvent(new Event('change'));
        }
      });

      // 3. Checkbox Change
      if (checkbox) {
        checkbox.addEventListener('change', () => {
          const val = checkbox.value;
          if (checkbox.checked) {
            selectedItems.add(val);
            card.classList.add('selected');
          } else {
            selectedItems.delete(val);
            card.classList.remove('selected');
          }
          updateBulkBar();
        });
      }

      // 4. Quick Move Folder Popover
      const btnFolder = card.querySelector('[data-action="quick-folder"]');
      if (btnFolder) {
        btnFolder.addEventListener('click', (e) => {
          e.stopPropagation();
          showQuickMovePopover(itemId, instanceId, itemName, checkVal, btnFolder);
        });
      }

      // 5. Custom Rich Tooltip on Image Hover
      const imgWrap = card.querySelector('.lho-card-img-wrap');
      if (imgWrap) {
        imgWrap.addEventListener('mouseenter', (e) => {
          showTooltip(card.dataset.name || card.dataset.cleanName, card.dataset.description, e);
        });
        imgWrap.addEventListener('mousemove', (e) => {
          updateTooltipPos(e);
        });
        imgWrap.addEventListener('mouseleave', () => {
          hideTooltip();
        });
      }
    });
  }

  function updateBulkBar() {
    const bar = document.getElementById('lho-bulk-bar');
    const countEl = document.getElementById('lho-selected-count');
    const root = document.getElementById('lioden-hoard-organizer');
    if (!bar || !countEl) return;

    const count = selectedItems.size;
    countEl.textContent = count;
    if (count > 0) {
      bar.classList.add('visible');
      if (root) root.classList.add('lho-bulk-active');
    } else {
      bar.classList.remove('visible');
      if (root) root.classList.remove('lho-bulk-active');
    }
  }

  // =========================================================================
  // 8. QUICK MOVE POPOVER MENU & POPOVER POSITIONING
  // =========================================================================

  function positionPopover(popover, anchorEl, alignOffset = 0) {
    document.body.appendChild(popover);
    const rect = anchorEl.getBoundingClientRect();
    const popoverWidth = popover.offsetWidth || 190;
    const popoverHeight = popover.offsetHeight || 150;

    // Vertical positioning: flip above anchor if overflowing viewport bottom
    let top = rect.bottom + window.scrollY + 4;
    if (rect.bottom + popoverHeight > window.innerHeight && rect.top - popoverHeight > 0) {
      top = rect.top + window.scrollY - popoverHeight - 4;
    }

    // Horizontal positioning: align to anchor, clamped within screen margins
    let left = rect.left + window.scrollX + alignOffset;
    const clientWidth = document.documentElement.clientWidth || window.innerWidth;
    const minLeft = window.scrollX + 8;
    const maxLeft = window.scrollX + clientWidth - popoverWidth - 8;
    left = Math.max(minLeft, Math.min(left, maxLeft));

    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
  }

  function showQuickMovePopover(itemId, instanceId, itemName, checkVal, anchorEl) {
    closeAllPopovers();

    const isBuried = checkIsBuriedPage();
    const inv = getCurrentInventory().find(i => String(i.amount > 1 ? i.item : i.id) === String(checkVal));

    // If multiple items are selected, include the clicked item as well
    const isMulti = selectedItems.size > 0;
    if (isMulti && checkVal) {
      selectedItems.add(String(checkVal));
    }

    const totalCount = isMulti ? selectedItems.size : 1;
    const headerText = isMulti ? `Move ${totalCount} Selected Items To:` : `Move To:`;

    const popover = document.createElement('div');
    popover.className = 'lho-popover';

    popover.innerHTML = `
      <div class="lho-popover-header">${headerText}</div>
      <div class="lho-popover-item" data-folder="unsorted">
        <span>📥</span> <span>Unsorted</span>
      </div>
      <div class="lho-popover-divider"></div>
      ${userFolders.map(f => `
        <div class="lho-popover-item" data-folder="${f.id}">
          <span class="lho-tab-dot" style="background: ${f.color};"></span>
          <span>${f.icon || '📁'}</span>
          <span>${escapeHtml(f.name)}</span>
        </div>
      `).join('')}
      <div class="lho-popover-divider"></div>
      <div class="lho-popover-item" data-action="new-folder">
        <span>➕</span> <b>New Folder...</b>
      </div>
      <div class="lho-popover-divider"></div>
      ${isBuried ? `
        <div class="lho-popover-item" data-action="dig-item">
          <span>⛏️</span> <span>Dig Up ${isMulti ? `${totalCount} Items` : 'Item'}</span>
        </div>
      ` : `
        <div class="lho-popover-item" data-action="bury-item">
          <span>🪦</span> <span>Bury ${isMulti ? `${totalCount} Items` : 'Item'}</span>
        </div>
      `}
    `;

    positionPopover(popover, anchorEl, -80);

    function applyMoveToFolder(targetFolderId) {
      const targetName = (targetFolderId === 'unsorted' || !targetFolderId)
        ? 'Unsorted'
        : (userFolders.find(f => f.id === targetFolderId)?.name || 'Folder');

      if (isMulti) {
        let movedCount = 0;
        getCurrentInventory().forEach(inv => {
          const val = String(inv.amount > 1 ? inv.item : inv.id);
          if (selectedItems.has(val)) {
            assignItemToFolder(inv.item, inv.id, targetFolderId === 'unsorted' ? null : targetFolderId);
            movedCount++;
          }
        });
        selectedItems.clear();
        showToast(`Moved ${movedCount} items to ${targetName}!`);
      } else {
        assignItemToFolder(itemId, instanceId, targetFolderId === 'unsorted' ? null : targetFolderId);
        showToast(`Moved "${itemName}" to ${targetName}!`);
      }

      closeAllPopovers();
      renderOrganizer();
    }

    popover.querySelectorAll('.lho-popover-item').forEach(item => {
      item.addEventListener('click', () => {
        const folderId = item.dataset.folder;
        if (folderId) {
          applyMoveToFolder(folderId);
        } else if (item.dataset.action === 'new-folder') {
          closeAllPopovers();
          showFolderModal(null, (newFolderId) => {
            applyMoveToFolder(newFolderId);
          });
        }
      });
    });

    const digItemBtn = popover.querySelector('[data-action="dig-item"]');
    if (digItemBtn) {
      digItemBtn.addEventListener('click', () => {
        closeAllPopovers();
        if (isMulti) {
          const itemsToDig = getCurrentInventory().filter(i => {
            const val = String(i.amount > 1 ? i.item : i.id);
            return selectedItems.has(val);
          });
          digItems(itemsToDig, 'Selected Items');
        } else if (inv) {
          digItems([inv], inv.name || itemName);
        }
      });
    }

    const buryItemBtn = popover.querySelector('[data-action="bury-item"]');
    if (buryItemBtn) {
      buryItemBtn.addEventListener('click', () => {
        closeAllPopovers();
        if (isMulti) {
          const itemsToBury = getCurrentInventory().filter(i => {
            const val = String(i.amount > 1 ? i.item : i.id);
            return selectedItems.has(val);
          });
          buryItems(itemsToBury, 'Selected Items');
        } else if (inv) {
          buryItems([inv], inv.name || itemName);
        }
      });
    }

    const closeHandler = (e) => {
      if (!popover.contains(e.target) && e.target !== anchorEl) {
        closeAllPopovers();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 10);
  }

  function showFolderSortMenu(anchorEl) {
    closeAllPopovers();

    const popover = document.createElement('div');
    popover.className = 'lho-popover';

    popover.innerHTML = `
      <div class="lho-popover-header">Sort Folders:</div>
      <div class="lho-popover-item" data-sort="name_asc">
        <span>🔤</span> <span>Name (A → Z)</span>
      </div>
      <div class="lho-popover-item" data-sort="name_desc">
        <span>🔤</span> <span>Name (Z → A)</span>
      </div>
      <div class="lho-popover-divider"></div>
      <div class="lho-popover-item" data-sort="size_desc">
        <span>📊</span> <span>Size (Most items first)</span>
      </div>
      <div class="lho-popover-item" data-sort="size_asc">
        <span>📊</span> <span>Size (Fewest items first)</span>
      </div>
    `;

    positionPopover(popover, anchorEl, -40);

    popover.querySelectorAll('.lho-popover-item').forEach(item => {
      item.addEventListener('click', () => {
        const sortMode = item.dataset.sort;
        if (sortMode === 'name_asc') {
          userFolders.sort((a, b) => a.name.localeCompare(b.name));
          showToast('Folders sorted A → Z!');
        } else if (sortMode === 'name_desc') {
          userFolders.sort((a, b) => b.name.localeCompare(a.name));
          showToast('Folders sorted Z → A!');
        } else if (sortMode === 'size_desc') {
          userFolders.sort((a, b) => countFolderItems(b.id) - countFolderItems(a.id));
          showToast('Folders sorted by size (largest first)!');
        } else if (sortMode === 'size_asc') {
          userFolders.sort((a, b) => countFolderItems(a.id) - countFolderItems(b.id));
          showToast('Folders sorted by size (smallest first)!');
        }
        saveStorageData();
        closeAllPopovers();
        renderOrganizer();
      });
    });

    const closeHandler = (e) => {
      if (!popover.contains(e.target) && e.target !== anchorEl) {
        closeAllPopovers();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 10);
  }

  function showFolderActionsMenu(folderId, anchorEl) {
    closeAllPopovers();

    const folderIdx = userFolders.findIndex(f => f.id === folderId);
    if (folderIdx === -1) return;
    const folder = userFolders[folderIdx];

    const canMoveLeft = folderIdx > 0;
    const canMoveRight = folderIdx < userFolders.length - 1;
    const isBuried = checkIsBuriedPage();

    const popover = document.createElement('div');
    popover.className = 'lho-popover';

    popover.innerHTML = `
      <div class="lho-popover-header">${escapeHtml(folder.name)}</div>
      <div class="lho-popover-item" data-action="edit">
        <span>✏️</span> <span>Edit Folder</span>
      </div>
      ${canMoveLeft ? `
        <div class="lho-popover-item" data-action="move-left">
          <span>⬅️</span> <span>Move Left</span>
        </div>
      ` : ''}
      ${canMoveRight ? `
        <div class="lho-popover-item" data-action="move-right">
          <span>➡️</span> <span>Move Right</span>
        </div>
      ` : ''}
      <div class="lho-popover-divider"></div>
      ${isBuried ? `
        <div class="lho-popover-item" data-action="dig-folder">
          <span>⛏️</span> <span>Dig Up All Items</span>
        </div>
      ` : `
        <div class="lho-popover-item" data-action="bury-folder">
          <span>🪦</span> <span>Bury All Items</span>
        </div>
        <div class="lho-popover-item" data-action="branch-folder">
          <span>🌿</span> <span>Put All on Branch</span>
        </div>
      `}
      <div class="lho-popover-divider"></div>
      <div class="lho-popover-item" data-action="delete" style="color: var(--lho-danger);">
        <span>🗑️</span> <span>Delete Folder</span>
      </div>
    `;

    positionPopover(popover, anchorEl, -60);

    popover.querySelector('[data-action="edit"]').addEventListener('click', () => {
      closeAllPopovers();
      showFolderModal(folder);
    });

    const moveLeftBtn = popover.querySelector('[data-action="move-left"]');
    if (moveLeftBtn) {
      moveLeftBtn.addEventListener('click', () => {
        closeAllPopovers();
        if (folderIdx > 0) {
          const [moved] = userFolders.splice(folderIdx, 1);
          userFolders.splice(folderIdx - 1, 0, moved);
          saveStorageData();
          showToast(`Moved "${moved.name}" left!`);
          renderOrganizer();
        }
      });
    }

    const moveRightBtn = popover.querySelector('[data-action="move-right"]');
    if (moveRightBtn) {
      moveRightBtn.addEventListener('click', () => {
        closeAllPopovers();
        if (folderIdx < userFolders.length - 1) {
          const [moved] = userFolders.splice(folderIdx, 1);
          userFolders.splice(folderIdx + 1, 0, moved);
          saveStorageData();
          showToast(`Moved "${moved.name}" right!`);
          renderOrganizer();
        }
      });
    }

    const digBtn = popover.querySelector('[data-action="dig-folder"]');
    if (digBtn) {
      digBtn.addEventListener('click', () => {
        closeAllPopovers();
        digFolderItems(folder.id);
      });
    }

    const buryBtn = popover.querySelector('[data-action="bury-folder"]');
    if (buryBtn) {
      buryBtn.addEventListener('click', () => {
        closeAllPopovers();
        buryFolderItems(folder.id);
      });
    }

    const branchBtn = popover.querySelector('[data-action="branch-folder"]');
    if (branchBtn) {
      branchBtn.addEventListener('click', () => {
        closeAllPopovers();
        putFolderOnBranch(folder.id);
      });
    }

    popover.querySelector('[data-action="delete"]').addEventListener('click', () => {
      closeAllPopovers();
      if (confirm(`Delete folder "${folder.name}"? Items inside will be moved to Unsorted.`)) {
        deleteFolder(folder.id);
      }
    });

    const closeHandler = (e) => {
      if (!popover.contains(e.target) && e.target !== anchorEl) {
        closeAllPopovers();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 10);
  }

  function closeAllPopovers() {
    document.querySelectorAll('.lho-popover').forEach(el => el.remove());
  }

  function syncSelectedItemsToForm(form) {
    form.querySelectorAll('.lho-temp-form-input').forEach(el => el.remove());

    const renderedValues = new Set();
    form.querySelectorAll('input.lho-card-check:checked').forEach(cb => {
      renderedValues.add(cb.value);
    });

    const invList = getCurrentInventory();
    invList.forEach(inv => {
      const val = String(inv.amount > 1 ? inv.item : inv.id);
      if (selectedItems.has(val) && !renderedValues.has(val)) {
        const hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.className = 'lho-temp-form-input';
        if (inv.amount > 1) {
          hidden.name = 'stack[]';
          hidden.value = inv.item;
        } else {
          hidden.name = 'item[]';
          hidden.value = inv.id;
        }
        form.appendChild(hidden);
      }
    });
  }

  function digItems(itemsToDig, label = '') {
    if (!itemsToDig || itemsToDig.length === 0) return;
    const count = itemsToDig.length;
    const countText = `${count} item${count === 1 ? '' : 's'}`;
    const confirmMsg = label
      ? `Are you sure you want to dig up ${countText} (${label})?`
      : `Are you sure you want to dig up ${countText}?`;
    if (!confirm(confirmMsg)) return;

    if (window.location.protocol === 'file:') {
      showToast(`[Preview] Dug up ${countText}!`);
      const itemSet = new Set(itemsToDig.map(inv => String(inv.amount > 1 ? inv.item : inv.id)));
      const moved = [];
      simulatedBuriedInventory = (simulatedBuriedInventory || []).filter(inv => {
        const val = String(inv.amount > 1 ? inv.item : inv.id);
        if (itemSet.has(val)) {
          moved.push(inv);
          return false;
        }
        return true;
      });
      simulatedActiveInventory = simulatedActiveInventory || [];
      moved.forEach(inv => simulatedActiveInventory.push(inv));
      selectedItems.clear();
      renderOrganizer();
      return;
    }

    // Submit native form to hoard.php?page=buried
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = window.location.pathname + (window.location.search || '');

    itemsToDig.forEach(inv => {
      const input = document.createElement('input');
      input.type = 'hidden';
      if (inv.amount > 1) {
        input.name = 'stack[]';
        input.value = inv.item;
      } else {
        input.name = 'item[]';
        input.value = inv.id;
      }
      form.appendChild(input);
    });

    const digInfo = getNativeInputInfo('dig');
    const submitInput = document.createElement('input');
    submitInput.type = 'hidden';
    submitInput.name = digInfo.name;
    submitInput.value = digInfo.value;
    form.appendChild(submitInput);

    document.body.appendChild(form);
    form.submit();
  }

  function digAllItems() {
    if (!confirm('Are you sure you want to dig up everything in your buried hoard?')) return;

    if (window.location.protocol === 'file:') {
      const count = (simulatedBuriedInventory || []).length;
      showToast(`[Preview] Dug up all ${count} buried items!`);
      simulatedActiveInventory = simulatedActiveInventory || [];
      (simulatedBuriedInventory || []).forEach(inv => simulatedActiveInventory.push(inv));
      simulatedBuriedInventory = [];
      selectedItems.clear();
      renderOrganizer();
      return;
    }

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = window.location.pathname + (window.location.search || '');

    const digAllInfo = getNativeInputInfo('dig-all');
    const submitInput = document.createElement('input');
    submitInput.type = 'hidden';
    submitInput.name = digAllInfo.name;
    submitInput.value = digAllInfo.value;
    form.appendChild(submitInput);

    document.body.appendChild(form);
    form.submit();
  }

  function buryItems(itemsToBury, label = '') {
    if (!itemsToBury || itemsToBury.length === 0) return;
    const count = itemsToBury.length;
    const countText = `${count} item${count === 1 ? '' : 's'}`;
    const confirmMsg = label
      ? `Are you sure you want to bury ${countText} (${label})?`
      : `Are you sure you want to bury ${countText}?`;
    if (!confirm(confirmMsg)) return;

    if (window.location.protocol === 'file:') {
      showToast(`[Preview] Buried ${countText}!`);
      const itemSet = new Set(itemsToBury.map(inv => String(inv.amount > 1 ? inv.item : inv.id)));
      const moved = [];
      simulatedActiveInventory = (simulatedActiveInventory || []).filter(inv => {
        const val = String(inv.amount > 1 ? inv.item : inv.id);
        if (itemSet.has(val)) {
          moved.push(inv);
          return false;
        }
        return true;
      });
      simulatedBuriedInventory = simulatedBuriedInventory || [];
      moved.forEach(inv => simulatedBuriedInventory.push(inv));
      selectedItems.clear();
      renderOrganizer();
      return;
    }

    // Submit native form to hoard.php
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = window.location.pathname + (window.location.search || '');

    itemsToBury.forEach(inv => {
      const input = document.createElement('input');
      input.type = 'hidden';
      if (inv.amount > 1) {
        input.name = 'stack[]';
        input.value = inv.item;
      } else {
        input.name = 'item[]';
        input.value = inv.id;
      }
      form.appendChild(input);
    });

    const buryInfo = getNativeInputInfo('bury');
    const submitInput = document.createElement('input');
    submitInput.type = 'hidden';
    submitInput.name = buryInfo.name;
    submitInput.value = buryInfo.value;
    form.appendChild(submitInput);

    document.body.appendChild(form);
    form.submit();
  }

  function buryFolderItems(folderId) {
    const folder = userFolders.find(f => f.id === folderId);
    if (!folder) return;

    const folderItems = getFolderInventory(folderId);
    if (folderItems.length === 0) {
      showToast(`Folder "${folder.name}" is empty.`);
      return;
    }

    buryItems(folderItems, `folder "${folder.name}"`);
  }

  function digFolderItems(folderId) {
    const folder = userFolders.find(f => f.id === folderId);
    if (!folder) return;

    const folderItems = getFolderInventory(folderId);
    if (folderItems.length === 0) {
      showToast(`Folder "${folder.name}" is empty.`);
      return;
    }

    digItems(folderItems, `folder "${folder.name}"`);
  }

  async function putFolderOnBranch(folderId) {
    const folder = userFolders.find(f => f.id === folderId);
    if (!folder) return;

    const folderItems = getFolderInventory(folderId);
    if (folderItems.length === 0) {
      showToast(`Folder "${folder.name}" is empty.`);
      return;
    }

    const count = folderItems.length;
    const countText = `${count} item${count === 1 ? '' : 's'}`;
    if (!confirm(`Are you sure you want to put all ${countText} in "${folder.name}" on your Branch?`)) {
      return;
    }

    if (window.location.protocol === 'file:') {
      showToast(`[Preview] Put all ${countText} from "${folder.name}" on Branch!`);
      const itemSet = new Set(folderItems.map(inv => inv.id || inv.item));
      const isBuried = checkIsBuriedPage();
      if (isBuried) {
        simulatedBuriedInventory = (simulatedBuriedInventory || []).filter(inv => !itemSet.has(inv.id || inv.item));
      } else {
        simulatedActiveInventory = (simulatedActiveInventory || []).filter(inv => !itemSet.has(inv.id || inv.item));
      }
      renderOrganizer();
      return;
    }

    submitItemsToBranch(folderItems, folder.name);
  }

  async function getStackItemIds(itemId) {
    try {
      const res = await fetch(`/hoard.php?stack=${itemId}`);
      if (!res.ok) return [];
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');

      // Method 1: Extract from script tag var inventoryData
      const scripts = Array.from(doc.querySelectorAll('script'));
      const targetScript = scripts.find(s => s.textContent.includes('var inventoryData = '));
      if (targetScript) {
        const text = targetScript.textContent;
        const invStart = text.indexOf('var inventoryData = ');
        if (invStart !== -1) {
          const activeStart = text.indexOf('var activeItems = ');
          const rawInv = text.slice(invStart + 'var inventoryData = '.length, activeStart !== -1 ? activeStart : text.length).trim().replace(/;$/, '');
          const invData = JSON.parse(rawInv);
          if (Array.isArray(invData) && invData.length > 0) {
            return invData.map(item => item.id).filter(Boolean);
          }
        }
      }

      // Method 2: Fallback extract from input[name="item[]"] checkboxes
      const checkboxes = Array.from(doc.querySelectorAll('input[name="item[]"]'));
      if (checkboxes.length > 0) {
        return checkboxes.map(cb => cb.value).filter(Boolean);
      }
    } catch (e) {
      console.warn('[LHO] Failed to fetch stack item IDs for item', itemId, e);
    }
    return [];
  }

  async function submitItemsToBranch(items, folderName) {
    if (!items || items.length === 0) return;

    showToast(`Transferring ${items.length} items to your Branch...`);

    const stackedList = [];
    const unstackedList = [];

    await Promise.all(items.map(async (inv) => {
      if (inv.amount > 1) {
        const stackIds = await getStackItemIds(inv.item);
        if (stackIds && stackIds.length > 0) {
          stackIds.forEach(id => unstackedList.push(id));
        } else {
          stackedList.push(inv.item);
        }
      } else {
        unstackedList.push(inv.id);
      }
    }));

    const isBuried = checkIsBuriedPage();
    const formData = new FormData();
    formData.append('source', isBuried ? 'buried' : 'hoard');
    formData.append('itemsStacked', stackedList.join(','));
    formData.append('itemsUnstacked', unstackedList.join(','));
    formData.append('run', 'branch');
    formData.append('action', 'Put On Branch');

    try {
      // Send POST request directly to hoard-organisation.php with user session
      const resp = await fetch('/hoard-organisation.php', {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });

      if (resp.ok) {
        showToast(`Moved ${items.length} items from "${folderName}" to your Branch! 🌿`, 4000);
        // Reload hoard page so user sees updated inventory immediately
        setTimeout(() => {
          window.location.reload();
        }, 1200);
      } else {
        throw new Error(`HTTP ${resp.status}`);
      }
    } catch (err) {
      console.warn('[LHO] Fetch branch transfer failed, falling back to direct form submit:', err);

      // Fallback: standard form POST to hoard-organisation.php
      const submitForm = document.createElement('form');
      submitForm.method = 'POST';
      submitForm.action = '/hoard-organisation.php';

      for (const [key, value] of formData.entries()) {
        const inp = document.createElement('input');
        inp.type = 'hidden';
        inp.name = key;
        inp.value = value;
        submitForm.appendChild(inp);
      }

      document.body.appendChild(submitForm);
      submitForm.submit();
    }
  }

  // =========================================================================
  // 9. MODALS: CREATE/EDIT FOLDER & SETTINGS
  // =========================================================================

  function showFolderModal(existingFolder = null, onCreateCallback = null) {
    closeModal();

    const isEdit = !!existingFolder;
    let selectedIcon = existingFolder ? existingFolder.icon : '📁';
    let selectedColor = existingFolder ? existingFolder.color : '#8E4C2A';

    const backdrop = document.createElement('div');
    backdrop.className = 'lho-modal-backdrop';
    backdrop.id = 'lho-modal-backdrop';

    backdrop.innerHTML = `
      <div class="lho-modal" style="max-width: 520px;">
        <div class="lho-modal-header">
          <span>${isEdit ? 'Edit Folder' : 'Create New Folder'}</span>
          <button type="button" class="lho-modal-close" id="lho-modal-close">&times;</button>
        </div>
        <div class="lho-modal-body">
          <div class="lho-form-group">
            <label class="lho-form-label">Folder Name</label>
            <input type="text" class="lho-form-input" id="lho-folder-name-input" placeholder="e.g. Breeding items, Applicators, Favorite decors..." value="${isEdit ? escapeHtml(existingFolder.name) : ''}">
          </div>

          <div class="lho-form-group">
            <label class="lho-form-label">Choose Color</label>
            <div class="lho-color-palette" id="lho-color-palette">
              ${PRESET_COLORS.map(color => `
                <div class="lho-color-swatch ${color === selectedColor ? 'selected' : ''}" style="background: ${color};" data-color="${color}"></div>
              `).join('')}
            </div>
          </div>

          <div class="lho-form-group">
            <label class="lho-form-label">Folder Icon</label>
            <div class="lho-emoji-picker-container">
              <div class="lho-emoji-search-row">
                <div class="lho-emoji-current-preview" id="lho-emoji-preview" style="border-color: ${selectedColor};" title="Selected Icon">
                  ${selectedIcon}
                </div>
                <input type="text" class="lho-emoji-search-input" id="lho-emoji-search-input" placeholder="🔍 Search 1,800+ emojis (e.g. lion, skull, meat, herb, star)...">
              </div>
              <div class="lho-emoji-custom-hint">
                <span>Click an emoji below, or type/paste any custom emoji.</span>
                <span id="lho-emoji-count-label" style="font-weight: 600;"></span>
              </div>
              <div class="lho-emoji-cat-bar" id="lho-emoji-cat-bar">
                <button type="button" class="lho-emoji-cat-chip active" data-cat="popular">⭐ Popular</button>
                <button type="button" class="lho-emoji-cat-chip" data-cat="animals">🐾 Animals &amp; Nature</button>
                <button type="button" class="lho-emoji-cat-chip" data-cat="food">🍖 Food &amp; Plants</button>
                <button type="button" class="lho-emoji-cat-chip" data-cat="objects">✨ Objects &amp; Loot</button>
                <button type="button" class="lho-emoji-cat-chip" data-cat="symbols">☀️ Symbols</button>
                <button type="button" class="lho-emoji-cat-chip" data-cat="all">All Emojis</button>
              </div>
              <div class="lho-emoji-grid-wrap">
                <div class="lho-emoji-grid" id="lho-emoji-grid">
                  <!-- Filtered emojis rendered here -->
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="lho-modal-footer">
          <button type="button" class="lho-btn lho-btn-outline" id="lho-modal-cancel">Cancel</button>
          <button type="button" class="lho-btn lho-btn-primary" id="lho-modal-save">${isEdit ? 'Save Changes' : 'Create Folder'}</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    const nameInput = backdrop.querySelector('#lho-folder-name-input');
    nameInput.focus();

    const emojiPreview = backdrop.querySelector('#lho-emoji-preview');
    const emojiSearch = backdrop.querySelector('#lho-emoji-search-input');
    const emojiGrid = backdrop.querySelector('#lho-emoji-grid');
    const emojiCatBar = backdrop.querySelector('#lho-emoji-cat-bar');
    const emojiCountLabel = backdrop.querySelector('#lho-emoji-count-label');

    const allEmojis = (typeof window !== 'undefined' ? window : globalThis).__LHO_EMOJIS__ || [];
    let currentCat = 'popular';
    let emojiDebounce = null;

    const POPULAR_LIST = [
      '📁', '🦁', '🦴', '🌿', '🍖', '🥩', '💎', '✨', '🐾', '🛡️', '⚔️', '🪲', '🐞', '🦗', '🕷️',
      '🦂', '🐍', '🦅', '🦉', '🪶', '💀', '☠️', '🩸', '📦', '🏷️', '🧪', '🧬', '🔮', '🌙', '☀️',
      '🔥', '💧', '🪵', '🪨', '🥚', '👑', '🏆', '⭐', '❤️', '🖤'
    ];

    function filterEmojis() {
      const q = emojiSearch ? emojiSearch.value.trim().toLowerCase() : '';
      let results = [];

      if (q) {
        if (/\p{Extended_Pictographic}/u.test(q)) {
          selectedIcon = q;
          if (emojiPreview) emojiPreview.textContent = q;
        }

        results = allEmojis.filter(item =>
          item.e === q ||
          item.n.includes(q) ||
          (item.k && item.k.includes(q))
        );
      } else if (currentCat === 'popular') {
        results = allEmojis.filter(item => POPULAR_LIST.includes(item.e));
        if (results.length === 0) {
          results = POPULAR_LIST.map(e => ({ e, n: '', k: '' }));
        }
      } else if (currentCat === 'animals') {
        const words = ['cat', 'dog', 'lion', 'animal', 'bird', 'prey', 'insect', 'bug', 'reptile', 'fish', 'bear', 'wolf', 'skull', 'bone', 'feather', 'egg', 'nest', 'paw'];
        results = allEmojis.filter(item => words.some(w => item.n.includes(w) || (item.k && item.k.includes(w))));
      } else if (currentCat === 'food') {
        const words = ['meat', 'food', 'apple', 'herb', 'plant', 'mushroom', 'drink', 'fruit', 'bread', 'meal', 'corn', 'beans'];
        results = allEmojis.filter(item => words.some(w => item.n.includes(w) || (item.k && item.k.includes(w))));
      } else if (currentCat === 'objects') {
        const words = ['book', 'sword', 'shield', 'crown', 'gem', 'box', 'package', 'tube', 'tool', 'key', 'potion', 'crystal', 'scroll', 'medal', 'trophy'];
        results = allEmojis.filter(item => words.some(w => item.n.includes(w) || (item.k && item.k.includes(w))));
      } else if (currentCat === 'symbols') {
        const words = ['star', 'sparkle', 'heart', 'moon', 'sun', 'fire', 'water', 'symbol', 'cross', 'circle', 'warning', 'check'];
        results = allEmojis.filter(item => words.some(w => item.n.includes(w) || (item.k && item.k.includes(w))));
      } else {
        results = allEmojis;
      }

      const displayResults = results.slice(0, 120);

      if (emojiCountLabel) {
        emojiCountLabel.textContent = `${results.length} emojis found`;
      }

      if (displayResults.length === 0) {
        emojiGrid.innerHTML = `
          <div class="lho-emoji-empty">
            No emojis found matching "${escapeHtml(q)}".<br>
            <span style="font-size: 11px;">You can type or paste any custom emoji directly into the box!</span>
          </div>
        `;
        return;
      }

      emojiGrid.innerHTML = displayResults.map(item => `
        <button type="button" class="lho-emoji-btn ${item.e === selectedIcon ? 'selected' : ''}"
                data-emoji="${item.e}"
                title="${escapeHtml(item.n)}">
          ${item.e}
        </button>
      `).join('');

      emojiGrid.querySelectorAll('.lho-emoji-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          updateSelectedIcon(btn.dataset.emoji);
        });
      });
    }

    function updateSelectedIcon(emoji) {
      selectedIcon = emoji;
      if (emojiPreview) emojiPreview.textContent = emoji;
      emojiGrid.querySelectorAll('.lho-emoji-btn').forEach(btn => {
        if (btn.dataset.emoji === emoji) {
          btn.classList.add('selected');
        } else {
          btn.classList.remove('selected');
        }
      });
    }

    if (emojiSearch) {
      emojiSearch.addEventListener('input', () => {
        clearTimeout(emojiDebounce);
        emojiDebounce = setTimeout(filterEmojis, 40);
      });
    }

    if (emojiCatBar) {
      emojiCatBar.querySelectorAll('.lho-emoji-cat-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          emojiCatBar.querySelectorAll('.lho-emoji-cat-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          currentCat = chip.dataset.cat;
          if (emojiSearch) emojiSearch.value = '';
          filterEmojis();
        });
      });
    }

    // Color Swatch Picker
    backdrop.querySelectorAll('.lho-color-swatch').forEach(btn => {
      btn.addEventListener('click', () => {
        backdrop.querySelectorAll('.lho-color-swatch').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedColor = btn.dataset.color;
        if (emojiPreview) emojiPreview.style.borderColor = selectedColor;
      });
    });

    // Save Button
    backdrop.querySelector('#lho-modal-save').addEventListener('click', () => {
      const name = nameInput.value.trim();
      if (!name) {
        alert('Please enter a folder name.');
        return;
      }

      if (isEdit) {
        existingFolder.name = name;
        existingFolder.icon = selectedIcon;
        existingFolder.color = selectedColor;
        saveStorageData();
        showToast(`Folder "${name}" updated!`);
      } else {
        const newId = 'f_' + Date.now();
        const newFolder = {
          id: newId,
          name: name,
          icon: selectedIcon,
          color: selectedColor,
          createdAt: Date.now()
        };
        userFolders.push(newFolder);
        activeFolderId = newId;
        saveStorageData();
        showToast(`Folder "${name}" created!`);
        if (onCreateCallback) onCreateCallback(newId);
      }

      closeModal();
      renderOrganizer();
    });

    backdrop.querySelector('#lho-modal-close').addEventListener('click', closeModal);
    backdrop.querySelector('#lho-modal-cancel').addEventListener('click', closeModal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });

    // Run initial filter
    filterEmojis();
  }

  function deleteFolder(folderId) {
    userFolders = userFolders.filter(f => f.id !== folderId);

    // Reassign items to unsorted
    Object.keys(itemFolderMap).forEach(key => {
      if (itemFolderMap[key] === folderId) delete itemFolderMap[key];
    });
    Object.keys(instanceFolderMap).forEach(key => {
      if (instanceFolderMap[key] === folderId) delete instanceFolderMap[key];
    });

    if (activeFolderId === folderId) activeFolderId = 'all';

    saveStorageData();
    showToast('Folder deleted. Items returned to Unsorted.');
    renderOrganizer();
  }

  function showSettingsModal() {
    closeModal();

    const backdrop = document.createElement('div');
    backdrop.className = 'lho-modal-backdrop';
    backdrop.id = 'lho-modal-backdrop';

    const otherAccounts = Object.keys(knownAccounts).filter(m => m !== currentMid);
    const hasLinkedAccount = checkHasLinkedAccount() || (linkedAccountsMode === 'separate');

    backdrop.innerHTML = `
      <div class="lho-modal">
        <div class="lho-modal-header">
          <span>⚙️ Backup, Restore & Settings</span>
          <button type="button" class="lho-modal-close" id="lho-modal-close">&times;</button>
        </div>
        <div class="lho-modal-body">
          ${hasLinkedAccount ? `
          <!-- Linked Accounts Setting -->
          <div class="lho-form-group">
            <label class="lho-form-label">Linked Accounts (Main & Side)</label>
            <p style="font-size: 12px; color: var(--lho-text-muted); margin-top: 2px;">
              Lioden players often have linked main and side accounts. Choose whether both accounts share the same folders or keep separate folders.
            </p>
            <div style="margin-top: 10px; display: flex; flex-direction: column; gap: 8px;">
              <label class="lho-radio-option ${linkedAccountsMode === 'shared' ? 'selected' : ''}">
                <input type="radio" name="lho-linked-mode" value="shared" ${linkedAccountsMode === 'shared' ? 'checked' : ''} style="margin-top: 2px;">
                <div>
                  <div style="font-weight: bold; color: var(--lho-text);">Shared Folders (Default)</div>
                  <div style="color: var(--lho-text-muted); font-size: 11px; margin-top: 2px;">
                    Both linked accounts share the exact same folder structure and item assignments.
                  </div>
                </div>
              </label>
              <label class="lho-radio-option ${linkedAccountsMode === 'separate' ? 'selected' : ''}">
                <input type="radio" name="lho-linked-mode" value="separate" ${linkedAccountsMode === 'separate' ? 'checked' : ''} style="margin-top: 2px;">
                <div>
                  <div style="font-weight: bold; color: var(--lho-text);">Separate Folders per Account</div>
                  <div style="color: var(--lho-text-muted); font-size: 11px; margin-top: 2px;">
                    Each linked account has its own independent folders and item assignments.
                  </div>
                </div>
              </label>
            </div>

            ${currentMid ? `
              <div style="margin-top: 10px; padding: 8px 12px; background: var(--lho-bg-card-selected); border: 1px solid var(--lho-border); border-radius: 6px; font-size: 11px; display: flex; align-items: center; justify-content: space-between;">
                <span>Active Account: <b>${escapeHtml(currentAccountName)}</b> (ID: <code>${currentMid}</code>)</span>
                <span class="lho-stats-pill" style="font-size: 10px; background: ${linkedAccountsMode === 'separate' ? 'var(--lho-accent)' : 'var(--lho-bg-tabs)'}; color: ${linkedAccountsMode === 'separate' ? '#fff' : 'var(--lho-text)'};">
                  ${linkedAccountsMode === 'separate' ? 'Separate Mode' : 'Shared Mode'}
                </span>
              </div>
            ` : ''}

            <!-- Tools when in Separate Mode -->
            <div id="lho-separate-tools" style="margin-top: 10px; display: ${linkedAccountsMode === 'separate' && currentMid ? 'flex' : 'none'}; flex-wrap: wrap; gap: 8px;">
              <button type="button" class="lho-btn lho-btn-outline lho-btn-sm" id="lho-btn-copy-from-shared" title="Copy folders from shared setup into this account">
                📋 Copy Folders from Shared Setup
              </button>
              ${otherAccounts.map(oMid => `
                <button type="button" class="lho-btn lho-btn-outline lho-btn-sm lho-btn-copy-from-other" data-mid="${oMid}">
                  📋 Copy from Account #${oMid} (${escapeHtml(knownAccounts[oMid].name || 'Side Account')})
                </button>
              `).join('')}
            </div>
          </div>
          ` : ''}

          <!-- Theme Appearance -->
          <div class="lho-form-group" style="${hasLinkedAccount ? 'margin-top: 20px; border-top: 1px solid var(--lho-border); padding-top: 15px;' : ''}">
            <label class="lho-form-label">Theme Appearance</label>
            <p style="font-size: 12px; color: var(--lho-text-muted); margin-top: 2px;">
              Automatically matches Lioden's Day, Night, or Desert theme, or choose a fixed mode.
            </p>
            <select class="lho-select" id="lho-modal-theme-select" style="width: 100%; margin-top: 6px;">
              <option value="auto" ${currentTheme === 'auto' ? 'selected' : ''}>Auto-detect (Current: ${resolvedTheme.charAt(0).toUpperCase() + resolvedTheme.slice(1)})</option>
              <option value="day" ${currentTheme === 'day' ? 'selected' : ''}>Day Mode (Classic Savanna)</option>
              <option value="night" ${currentTheme === 'night' ? 'selected' : ''}>Night Mode (Muted Slate / Night)</option>
              <option value="desert" ${currentTheme === 'desert' ? 'selected' : ''}>Desert Mode (Warm Sandstone)</option>
            </select>
          </div>

          <!-- Export / Backup Folders -->
          <div class="lho-form-group" style="margin-top: 20px; border-top: 1px solid var(--lho-border); padding-top: 15px;">
            <label class="lho-form-label">Export / Backup Folders</label>
            <p style="font-size: 12px; color: var(--lho-text-muted); margin-top: 2px;">
              Download a backup JSON file containing all your folders and item assignments${linkedAccountsMode === 'separate' && currentMid ? ` for Account #${currentMid}` : ''}.
            </p>
            <button type="button" class="lho-btn lho-btn-primary lho-btn-sm" id="lho-btn-export-json">
              📥 Export Backup (JSON)
            </button>
          </div>

          <!-- Import / Restore Backup -->
          <div class="lho-form-group" style="margin-top: 20px; border-top: 1px solid var(--lho-border); padding-top: 15px;">
            <label class="lho-form-label">Import / Restore Backup</label>
            <p style="font-size: 12px; color: var(--lho-text-muted); margin-top: 2px;">
              Restore your folders and assignments from a previously saved JSON backup file.
            </p>
            <input type="file" id="lho-file-import-json" accept=".json" style="font-size: 12px; margin-bottom: 8px;">
            <br>
            <button type="button" class="lho-btn lho-btn-outline lho-btn-sm" id="lho-btn-import-json">
              📤 Import File
            </button>
          </div>

          <!-- Danger Zone -->
          <div class="lho-form-group" style="margin-top: 20px; border-top: 1px solid var(--lho-border); padding-top: 15px;">
            <label class="lho-form-label" style="color: var(--lho-danger);">Danger Zone</label>
            <p style="font-size: 12px; color: var(--lho-text-muted); margin-top: 2px;">
              Clear all custom folders and item assignments back to default settings${linkedAccountsMode === 'separate' && currentMid ? ` for Account #${currentMid}` : ''}.
            </p>
            <button type="button" class="lho-btn lho-btn-danger lho-btn-sm" id="lho-btn-reset-all">
              ⚠️ Reset Everything
            </button>
          </div>
        </div>
        <div class="lho-modal-footer">
          <button type="button" class="lho-btn lho-btn-outline" id="lho-modal-close-btn">Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    // Linked Accounts Mode Change Handler
    backdrop.querySelectorAll('input[name="lho-linked-mode"]').forEach(radio => {
      radio.addEventListener('change', async (e) => {
        const newMode = e.target.value;
        if (newMode === linkedAccountsMode) return;

        if (newMode === 'separate') {
          if (!currentMid) {
            alert('Could not detect an active Lioden member ID on this page. Separate folders requires a logged-in account.');
            radio.checked = false;
            return;
          }
          linkedAccountsMode = 'separate';
          const accountKey = STORAGE_KEY + '_' + currentMid;
          let existingAccData = null;
          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            existingAccData = await new Promise(r => chrome.storage.local.get([accountKey], res => r(res[accountKey])));
          } else {
            const raw = localStorage.getItem(accountKey);
            if (raw) try { existingAccData = JSON.parse(raw); } catch (err) {}
          }

          if (existingAccData && Array.isArray(existingAccData.folders)) {
            userFolders = existingAccData.folders;
            itemFolderMap = existingAccData.itemMap || {};
            instanceFolderMap = existingAccData.instanceMap || {};
          }
          await saveStorageData();
          renderOrganizer();
          closeModal();
          showToast(`Switched to separate folders for Account #${currentMid}!`);
        } else {
          if (!confirm('Switch to shared folders? Both linked accounts will share the same folder list and assignments.')) {
            const separateRadio = backdrop.querySelector('input[name="lho-linked-mode"][value="separate"]');
            if (separateRadio) separateRadio.checked = true;
            return;
          }
          linkedAccountsMode = 'shared';
          await saveStorageData();
          await loadStorageData();
          renderOrganizer();
          closeModal();
          showToast('Switched to shared folders across linked accounts!');
        }
      });
    });

    // Copy from Shared Setup Handler
    const btnCopyShared = backdrop.querySelector('#lho-btn-copy-from-shared');
    if (btnCopyShared) {
      btnCopyShared.addEventListener('click', async () => {
        if (!confirm(`Copy folders from shared setup into Account #${currentMid}? This will replace your current account's folders.`)) return;
        let sharedData = null;
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          sharedData = await new Promise(r => chrome.storage.local.get([STORAGE_KEY], res => r(res[STORAGE_KEY])));
        } else {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) try { sharedData = JSON.parse(raw); } catch (err) {}
        }
        if (sharedData && Array.isArray(sharedData.folders)) {
          userFolders = JSON.parse(JSON.stringify(sharedData.folders));
          itemFolderMap = JSON.parse(JSON.stringify(sharedData.itemMap || {}));
          instanceFolderMap = JSON.parse(JSON.stringify(sharedData.instanceMap || {}));
        } else {
          userFolders = [...DEFAULT_FOLDERS];
          itemFolderMap = {};
          instanceFolderMap = {};
        }
        await saveStorageData();
        renderOrganizer();
        closeModal();
        showToast(`Shared folders copied into Account #${currentMid}!`);
      });
    }

    // Copy from Other Account Handlers
    backdrop.querySelectorAll('.lho-btn-copy-from-other').forEach(btn => {
      btn.addEventListener('click', async () => {
        const sourceMid = btn.dataset.mid;
        if (!sourceMid) return;
        const sourceName = (knownAccounts[sourceMid] && knownAccounts[sourceMid].name) || ('Account #' + sourceMid);
        if (!confirm(`Copy folders from ${sourceName} into Account #${currentMid}? This will replace your current account's folders.`)) return;
        const sourceKey = STORAGE_KEY + '_' + sourceMid;
        let sourceData = null;
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          sourceData = await new Promise(r => chrome.storage.local.get([sourceKey], res => r(res[sourceKey])));
        } else {
          const raw = localStorage.getItem(sourceKey);
          if (raw) try { sourceData = JSON.parse(raw); } catch (err) {}
        }
        if (sourceData && Array.isArray(sourceData.folders)) {
          userFolders = JSON.parse(JSON.stringify(sourceData.folders));
          itemFolderMap = JSON.parse(JSON.stringify(sourceData.itemMap || {}));
          instanceFolderMap = JSON.parse(JSON.stringify(sourceData.instanceMap || {}));
        }
        await saveStorageData();
        renderOrganizer();
        closeModal();
        showToast(`Folders copied from ${sourceName} into Account #${currentMid}!`);
      });
    });

    // Theme Selection Handler
    const modalThemeSelect = backdrop.querySelector('#lho-modal-theme-select');
    if (modalThemeSelect) {
      modalThemeSelect.addEventListener('change', (e) => {
        currentTheme = e.target.value;
        applyTheme();
        saveStorageData();
        renderOrganizer();
        const displayThemeName = currentTheme === 'auto' ? `Auto (${resolvedTheme})` : (currentTheme.charAt(0).toUpperCase() + currentTheme.slice(1));
        showToast(`Theme updated to ${displayThemeName}`);
      });
    }

    // Export Handler
    backdrop.querySelector('#lho-btn-export-json').addEventListener('click', () => {
      const extVersion = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest)
        ? (chrome.runtime.getManifest()?.version || '1.1.4')
        : '1.1.4';
      const exportData = {
        version: extVersion,
        exportedAt: new Date().toISOString(),
        account: currentMid,
        accountName: currentAccountName,
        linkedAccountsMode: linkedAccountsMode,
        folders: userFolders,
        itemMap: itemFolderMap,
        instanceMap: instanceFolderMap
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const accSuffix = (linkedAccountsMode === 'separate' && currentMid) ? `_acc${currentMid}` : '';
      a.download = `lioden_hoard_folders${accSuffix}_${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Backup JSON exported successfully!');
    });

    // Import Handler
    backdrop.querySelector('#lho-btn-import-json').addEventListener('click', () => {
      const fileInput = backdrop.querySelector('#lho-file-import-json');
      if (!fileInput.files || !fileInput.files[0]) {
        alert('Please select a .json backup file first.');
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const imported = JSON.parse(event.target.result);
          if (!imported.folders || !Array.isArray(imported.folders)) {
            throw new Error('Invalid format: missing folders array.');
          }
          userFolders = imported.folders;
          itemFolderMap = imported.itemMap || {};
          instanceFolderMap = imported.instanceMap || {};
          saveStorageData();
          closeModal();
          showToast('Backup restored successfully!');
          renderOrganizer();
        } catch (err) {
          alert('Failed to import backup: ' + err.message);
        }
      };
      reader.readAsText(fileInput.files[0]);
    });

    // Reset All Handler
    backdrop.querySelector('#lho-btn-reset-all').addEventListener('click', () => {
      const promptText = (linkedAccountsMode === 'separate' && currentMid)
        ? `Are you sure you want to reset all folders and item assignments for Account #${currentMid}? This cannot be undone.`
        : 'Are you sure you want to reset all shared folders and item assignments? This cannot be undone.';
      if (confirm(promptText)) {
        userFolders = [];
        itemFolderMap = {};
        instanceFolderMap = {};
        activeFolderId = 'all';
        saveStorageData();
        closeModal();
        showToast(linkedAccountsMode === 'separate' ? `Folders reset for Account #${currentMid}.` : 'Organizer reset to default folders.');
        renderOrganizer();
      }
    });

    backdrop.querySelector('#lho-modal-close').addEventListener('click', closeModal);
    backdrop.querySelector('#lho-modal-close-btn').addEventListener('click', closeModal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });
  }

  function closeModal() {
    const backdrop = document.getElementById('lho-modal-backdrop');
    if (backdrop) backdrop.remove();
  }

  // =========================================================================
  // 10. CUSTOM RICH TOOLTIP
  // =========================================================================

  function initTooltip() {
    if (tooltipEl) return;
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'lho-tooltip lho-hidden';
    document.body.appendChild(tooltipEl);
    document.addEventListener('touchstart', hideTooltip, { passive: true });
  }

  function showTooltip(title, description, e) {
    if (!tooltipEl) initTooltip();
    tooltipEl.textContent = '';

    const titleEl = document.createElement('div');
    titleEl.className = 'lho-tooltip-title';
    titleEl.textContent = decodeHtml(title);
    tooltipEl.appendChild(titleEl);

    if (description) {
      const descEl = document.createElement('div');
      descEl.textContent = decodeHtml(description);
      tooltipEl.appendChild(descEl);
    }

    tooltipEl.classList.remove('lho-hidden');
    updateTooltipPos(e);
  }

  function updateTooltipPos(e) {
    if (!tooltipEl || tooltipEl.classList.contains('lho-hidden')) return;
    const pad = 12;
    let x = e.clientX + pad;
    let y = e.clientY + pad;

    if (x + 250 > window.innerWidth) {
      x = e.clientX - 260;
    }
    if (y + 120 > window.innerHeight) {
      y = e.clientY - 130;
    }

    tooltipEl.style.left = `${x}px`;
    tooltipEl.style.top = `${y}px`;
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.classList.add('lho-hidden');
  }

  // =========================================================================
  // 11. TOAST NOTIFICATIONS
  // =========================================================================

  function showToast(message) {
    let container = document.getElementById('lho-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'lho-toast-container';
      container.className = 'lho-toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'lho-toast';
    toast.innerHTML = `<span>🦁</span><span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2800);
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

  function decodeHtml(str) {
    if (!str) return '';
    let result = String(str);
    result = result.replace(/&amp;#0*39;|&amp;apos;/g, "'");
    result = result.replace(/&amp;quot;/g, '"');
    result = result.replace(/&amp;lt;/g, '<');
    result = result.replace(/&amp;gt;/g, '>');
    result = result.replace(/&amp;amp;/g, '&');
    result = result.replace(/&#0*39;|&apos;/g, "'");
    result = result.replace(/&quot;/g, '"');
    result = result.replace(/&lt;/g, '<');
    result = result.replace(/&gt;/g, '>');
    result = result.replace(/&amp;/g, '&');
    return result;
  }

  // =========================================================================
  // 12. BOOTSTRAP INITIALIZATION
  // =========================================================================

  async function init() {
    // 1. If viewing a stacked item page, do not initialize the organizer;
    // allow the default Lioden stack page to display untouched.
    if (checkIsStackPage()) {
      return;
    }

    // 2. Must have native hoard container #fraHoardList
    if (!document.getElementById('fraHoardList')) {
      return;
    }

    hoardData = extractHoardData();
    if (!hoardData) {
      setTimeout(() => {
        if (checkIsStackPage()) return;
        if (!document.getElementById('fraHoardList')) return;
        hoardData = extractHoardData();
        if (hoardData) {
          loadStorageData().then(initOrganizerUI);
        }
      }, 300);
      return;
    }

    await loadStorageData();
    initOrganizerUI();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
