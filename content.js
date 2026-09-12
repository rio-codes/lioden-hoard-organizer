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
  let pageSize = 'all'; // 'all', 50, 100, 200
  let currentPage = 1;
  let isFolderViewEnabled = true;

  // Selected checkbox values across current view
  let selectedItems = new Set(); // Set of string values

  // Active Tooltip element
  let tooltipEl = null;

  // =========================================================================
  // 1. DATA EXTRACTION FROM LIODEN PAGE
  // =========================================================================

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
          inv.is_custom = item.is_custom == 1;
        }
      }

      return { itemData, inventoryData };
    } catch (e) {
      console.error('[LHO] Error extracting hoard data:', e);
      return null;
    }
  }

  // =========================================================================
  // 2. STORAGE MANAGEMENT
  // =========================================================================

  async function loadStorageData() {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([STORAGE_KEY, SETTINGS_KEY], (res) => {
          const data = res[STORAGE_KEY] || {};
          const settings = res[SETTINGS_KEY] || {};

          userFolders = data.folders || DEFAULT_FOLDERS;
          itemFolderMap = data.itemMap || {};
          instanceFolderMap = data.instanceMap || {};

          if (typeof settings.enabled === 'boolean') isFolderViewEnabled = settings.enabled;
          if (settings.activeFolderId) activeFolderId = settings.activeFolderId || 'unsorted';
          if (settings.sortBy) sortBy = settings.sortBy;
          if (settings.pageSize) pageSize = settings.pageSize;

          resolve();
        });
      } else {
        const rawData = localStorage.getItem(STORAGE_KEY);
        const rawSettings = localStorage.getItem(SETTINGS_KEY);
        const data = rawData ? JSON.parse(rawData) : {};
        const settings = rawSettings ? JSON.parse(rawSettings) : {};

        userFolders = data.folders || DEFAULT_FOLDERS;
        itemFolderMap = data.itemMap || {};
        instanceFolderMap = data.instanceMap || {};

        if (typeof settings.enabled === 'boolean') isFolderViewEnabled = settings.enabled;
        if (settings.activeFolderId) activeFolderId = settings.activeFolderId || 'unsorted';
        if (settings.sortBy) sortBy = settings.sortBy;
        if (settings.pageSize) pageSize = settings.pageSize;

        resolve();
      }
    });
  }

  async function saveStorageData() {
    const data = {
      folders: userFolders,
      itemMap: itemFolderMap,
      instanceMap: instanceFolderMap
    };
    const settings = {
      enabled: isFolderViewEnabled,
      activeFolderId: activeFolderId,
      sortBy: sortBy,
      pageSize: pageSize
    };

    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [STORAGE_KEY]: data, [SETTINGS_KEY]: settings }, resolve);
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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
    if (!hoardData) return 0;
    return hoardData.inventoryData.filter(inv => {
      const f = getItemFolder(inv);
      if (folderId === 'all') return true;
      if (folderId === 'unsorted') return f === null;
      return f === folderId;
    }).length;
  }

  // =========================================================================
  // 4. UI CREATION & INJECTION
  // =========================================================================

  function initOrganizerUI() {
    // Look for form that contains fraHoardList, or general form
    const fraHoard = document.getElementById('fraHoardList');
    const hoardForm = fraHoard ? fraHoard.closest('form') : document.querySelector('form[method="post"]');

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

    // Render full organizer
    renderOrganizer();

    // Update view mode display
    updateViewMode();
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

    const totalCount = hoardData.inventoryData.length;
    const unsortedCount = countFolderItems('unsorted');

    root.innerHTML = `
      <!-- Header -->
      <div class="lho-header">
        <div class="lho-title-area">
          <span class="lho-title">🦁 Hoard Organizer</span>
          <span class="lho-stats-pill">${totalCount} Items • ${userFolders.length} Folders</span>
        </div>
        <div class="lho-header-actions">
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

      <!-- Folder Navigation Tabs -->
      <div class="lho-tabs-wrapper">
        <div class="lho-tabs-container" id="lho-folder-tabs">
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
              <div class="lho-tab ${activeFolderId === folder.id ? 'active' : ''}" data-folder-id="${folder.id}">
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
        </div>
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
          <!-- Page Limit -->
          <span style="font-size: 11px; color: var(--lho-text-muted);">Display:</span>
          <select class="lho-select" id="lho-pagesize-select">
            <option value="all" ${pageSize === 'all' ? 'selected' : ''}>All (Aggregated)</option>
            <option value="50" ${pageSize === '50' ? 'selected' : ''}>50 per page</option>
            <option value="100" ${pageSize === '100' ? 'selected' : ''}>100 per page</option>
            <option value="200" ${pageSize === '200' ? 'selected' : ''}>200 per page</option>
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

          <!-- Native Bury Action Integration -->
          <input type="submit" name="buryall" value="Bury Selected" class="lho-btn lho-btn-danger lho-btn-sm" onclick="return confirm('Are you sure you want to bury these selected items?');">
        </div>
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
  }

  function renderFolderBanner() {
    if (activeFolderId === 'all' || activeFolderId === 'unsorted') return '';

    const folder = userFolders.find(f => f.id === activeFolderId);
    if (!folder) return '';

    const count = countFolderItems(folder.id);

    return `
      <div class="lho-folder-banner">
        <div class="lho-folder-info">
          <span class="lho-tab-dot" style="background: ${folder.color}; width: 14px; height: 14px;"></span>
          <span class="lho-folder-name-lg">${folder.icon || '📁'} ${escapeHtml(folder.name)}</span>
          <span class="lho-stats-pill" style="background: #E0D4C1; color: var(--lho-text);">${count} items</span>
        </div>
        <div style="display: flex; gap: 6px;">
          <button type="button" class="lho-btn lho-btn-outline lho-btn-sm" id="lho-btn-edit-folder" data-id="${folder.id}">
            ✏️ Edit Folder
          </button>
          <button type="button" class="lho-btn lho-btn-danger lho-btn-sm" id="lho-btn-delete-folder" data-id="${folder.id}">
            🗑️ Delete Folder
          </button>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // 6. ITEMS FILTERING, SORTING & RENDERING
  // =========================================================================

  function getFilteredItems() {
    if (!hoardData) return [];

    let items = hoardData.inventoryData.filter(inv => {
      const folder = getItemFolder(inv);

      // Folder Filter
      if (activeFolderId === 'unsorted') {
        if (folder !== null) return false;
      } else if (activeFolderId !== 'all') {
        if (folder !== activeFolderId) return false;
      }

      // Search Query
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesName = (inv.name && inv.name.toLowerCase().includes(q)) || 
                            (inv.nameClean && inv.nameClean.toLowerCase().includes(q));
        const matchesDesc = inv.description && inv.description.toLowerCase().includes(q);
        if (!matchesName && !matchesDesc) return false;
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

  function renderItemsGrid() {
    const grid = document.getElementById('lho-items-grid');
    const paginationBar = document.getElementById('lho-pagination-bar');
    if (!grid) return;

    const filtered = getFilteredItems();

    // Pagination calculations
    const limit = pageSize === 'all' ? filtered.length : parseInt(pageSize, 10);
    const totalPages = Math.max(1, Math.ceil(filtered.length / limit));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIdx = (currentPage - 1) * limit;
    const visibleItems = filtered.slice(startIdx, startIdx + limit);

    if (visibleItems.length === 0) {
      grid.innerHTML = `
        <div class="lho-empty-state" style="grid-column: 1 / -1;">
          <div class="lho-empty-icon">📦</div>
          <div class="lho-empty-title">No items found</div>
          <div class="lho-empty-desc">
            ${searchQuery || categoryFilter !== 'all' 
              ? 'No items match your current search or category filter.' 
              : activeFolderId === 'unsorted'
                ? 'All items in your hoard have been organized into folders!'
                : 'This folder is empty. Drag and drop items here, or use the folder menu (📁▾) on any item card.'}
          </div>
        </div>
      `;
      if (paginationBar) paginationBar.innerHTML = '';
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
    const useUrl = isStacked ? `/hoard.php?stack=${inv.item}` : `/use.php?id=${inv.id}`;
    const useText = isStacked ? `${inv.amount} Stacked` : `${inv.totaluses} ${inv.totaluses === 1 ? 'use' : 'uses'}`;

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
          <a href="${useUrl}">
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
          <a href="${useUrl}" class="lho-card-link">${useText}</a>
          <button type="button" class="lho-card-folder-btn" title="Move to folder" data-action="quick-folder">
            📁▾
          </button>
        </div>
      </div>
    `;
  }

  function renderPaginationControls(totalResults, totalPages, startIdx, pageCount) {
    const bar = document.getElementById('lho-pagination-bar');
    if (!bar) return;

    if (pageSize === 'all' || totalPages <= 1) {
      bar.innerHTML = `
        <span style="color: var(--lho-text-muted);">Showing all <b>${totalResults}</b> items</span>
      `;
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
      tabsContainer.querySelectorAll('.lho-tab').forEach(tab => {
        const folderId = tab.dataset.folderId;

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

        // HTML5 Drag and Drop Target
        tab.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          tab.classList.add('drag-over');
        });

        tab.addEventListener('dragleave', () => {
          tab.classList.remove('drag-over');
        });

        tab.addEventListener('drop', (e) => {
          e.preventDefault();
          tab.classList.remove('drag-over');
          try {
            const dragData = JSON.parse(e.dataTransfer.getData('text/plain'));
            const targetFolderId = folderId === 'all' ? null : folderId;
            const targetFolderName = folderId === 'unsorted' ? 'Unsorted' : (userFolders.find(f => f.id === folderId)?.name || 'Folder');

            // If dragging item is part of a multi-selection, move all selected items
            if (dragData.checkValue && selectedItems.has(dragData.checkValue) && selectedItems.size > 1) {
              let movedCount = 0;
              hoardData.inventoryData.forEach(inv => {
                const val = String(inv.amount > 1 ? inv.item : inv.id);
                if (selectedItems.has(val)) {
                  assignItemToFolder(inv.item, inv.id, targetFolderId);
                  movedCount++;
                }
              });
              selectedItems.clear();
              showToast(`Moved ${movedCount} selected items to ${targetFolderName}!`);
            } else if (dragData && dragData.itemId) {
              // Single item drag
              assignItemToFolder(dragData.itemId, dragData.id, targetFolderId);
              showToast(`Moved "${dragData.name || 'Item'}" to ${targetFolderName}!`);
            }
            renderOrganizer();
          } catch (err) {
            console.error('[LHO] Drop error:', err);
          }
        });
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

        hoardData.inventoryData.forEach(inv => {
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

    // Folder Banner Actions (Edit / Delete)
    const btnEditFolder = root.querySelector('#lho-btn-edit-folder');
    const btnDeleteFolder = root.querySelector('#lho-btn-delete-folder');
    if (btnEditFolder) {
      btnEditFolder.addEventListener('click', () => {
        const folder = userFolders.find(f => f.id === btnEditFolder.dataset.id);
        if (folder) showFolderModal(folder);
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
          showTooltip(card.dataset.cleanName || card.dataset.name, card.dataset.description, e);
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
    if (!bar || !countEl) return;

    const count = selectedItems.size;
    countEl.textContent = count;
    if (count > 0) {
      bar.classList.add('visible');
    } else {
      bar.classList.remove('visible');
    }
  }

  // =========================================================================
  // 8. QUICK MOVE POPOVER MENU
  // =========================================================================

  function showQuickMovePopover(itemId, instanceId, itemName, checkVal, anchorEl) {
    closeAllPopovers();

    // If multiple items are selected, include the clicked item as well
    const isMulti = selectedItems.size > 0;
    if (isMulti && checkVal) {
      selectedItems.add(String(checkVal));
    }

    const totalCount = isMulti ? selectedItems.size : 1;
    const headerText = isMulti ? `Move ${totalCount} Selected Items To:` : `Move To:`;

    const popover = document.createElement('div');
    popover.className = 'lho-popover';

    const rect = anchorEl.getBoundingClientRect();
    popover.style.top = `${rect.bottom + window.scrollY + 4}px`;
    popover.style.left = `${Math.max(10, rect.left + window.scrollX - 100)}px`;

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
    `;

    document.body.appendChild(popover);

    function applyMoveToFolder(targetFolderId) {
      const targetName = (targetFolderId === 'unsorted' || !targetFolderId)
        ? 'Unsorted'
        : (userFolders.find(f => f.id === targetFolderId)?.name || 'Folder');

      if (isMulti) {
        let movedCount = 0;
        hoardData.inventoryData.forEach(inv => {
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

    const folder = userFolders.find(f => f.id === folderId);
    if (!folder) return;

    const popover = document.createElement('div');
    popover.className = 'lho-popover';

    const rect = anchorEl.getBoundingClientRect();
    popover.style.top = `${rect.bottom + window.scrollY + 4}px`;
    popover.style.left = `${rect.left + window.scrollX - 60}px`;

    popover.innerHTML = `
      <div class="lho-popover-header">${escapeHtml(folder.name)}</div>
      <div class="lho-popover-item" data-action="edit">
        <span>✏️</span> <span>Edit Folder</span>
      </div>
      <div class="lho-popover-item" data-action="delete" style="color: var(--lho-danger);">
        <span>🗑️</span> <span>Delete Folder</span>
      </div>
    `;

    document.body.appendChild(popover);

    popover.querySelector('[data-action="edit"]').addEventListener('click', () => {
      closeAllPopovers();
      showFolderModal(folder);
    });

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
      <div class="lho-modal">
        <div class="lho-modal-header">
          <span>${isEdit ? 'Edit Folder' : 'Create New Folder'}</span>
          <button type="button" class="lho-modal-close" id="lho-modal-close">&times;</button>
        </div>
        <div class="lho-modal-body">
          <div class="lho-form-group">
            <label class="lho-form-label">Folder Name</label>
            <input type="text" class="lho-form-input" id="lho-folder-name-input" placeholder="e.g. Breeding applicators, Favorite decors..." value="${isEdit ? escapeHtml(existingFolder.name) : ''}">
          </div>

          <div class="lho-form-group">
            <label class="lho-form-label">Choose Icon</label>
            <div class="lho-icon-palette" id="lho-icon-palette">
              ${PRESET_ICONS.map(icon => `
                <div class="lho-icon-choice ${icon === selectedIcon ? 'selected' : ''}" data-icon="${icon}">
                  ${icon}
                </div>
              `).join('')}
            </div>
          </div>

          <div class="lho-form-group">
            <label class="lho-form-label">Choose Color</label>
            <div class="lho-color-palette" id="lho-color-palette">
              ${PRESET_COLORS.map(color => `
                <div class="lho-color-swatch ${color === selectedColor ? 'selected' : ''}" style="background: ${color};" data-color="${color}"></div>
              `).join('')}
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

    // Icon Picker
    backdrop.querySelectorAll('.lho-icon-choice').forEach(btn => {
      btn.addEventListener('click', () => {
        backdrop.querySelectorAll('.lho-icon-choice').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedIcon = btn.dataset.icon;
      });
    });

    // Color Swatch Picker
    backdrop.querySelectorAll('.lho-color-swatch').forEach(btn => {
      btn.addEventListener('click', () => {
        backdrop.querySelectorAll('.lho-color-swatch').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedColor = btn.dataset.color;
      });
    });

    // Save
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

    backdrop.innerHTML = `
      <div class="lho-modal">
        <div class="lho-modal-header">
          <span>⚙️ Backup, Restore & Settings</span>
          <button type="button" class="lho-modal-close" id="lho-modal-close">&times;</button>
        </div>
        <div class="lho-modal-body">
          <div class="lho-form-group">
            <label class="lho-form-label">Export / Backup Folders</label>
            <p style="font-size: 12px; color: var(--lho-text-muted); margin-top: 2px;">
              Download a backup JSON file containing all your folders and item assignments.
            </p>
            <button type="button" class="lho-btn lho-btn-primary lho-btn-sm" id="lho-btn-export-json">
              📥 Export Backup (JSON)
            </button>
          </div>

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

          <div class="lho-form-group" style="margin-top: 20px; border-top: 1px solid var(--lho-border); padding-top: 15px;">
            <label class="lho-form-label" style="color: var(--lho-danger);">Danger Zone</label>
            <p style="font-size: 12px; color: var(--lho-text-muted); margin-top: 2px;">
              Clear all custom folders and item assignments back to default settings.
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

    // Export Handler
    backdrop.querySelector('#lho-btn-export-json').addEventListener('click', () => {
      const exportData = {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        folders: userFolders,
        itemMap: itemFolderMap,
        instanceMap: instanceFolderMap
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lioden_hoard_folders_${new Date().toISOString().slice(0,10)}.json`;
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
      if (confirm('Are you sure you want to reset all folders and item assignments? This cannot be undone.')) {
        userFolders = [];
        itemFolderMap = {};
        instanceFolderMap = {};
        activeFolderId = 'all';
        saveStorageData();
        closeModal();
        showToast('Organizer reset to default folders.');
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
  }

  function showTooltip(title, description, e) {
    if (!tooltipEl) initTooltip();
    tooltipEl.innerHTML = `
      <div class="lho-tooltip-title">${escapeHtml(title)}</div>
      <div>${description || ''}</div>
    `;
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

  // =========================================================================
  // 12. BOOTSTRAP INITIALIZATION
  // =========================================================================

  async function init() {
    hoardData = extractHoardData();
    if (!hoardData) {
      setTimeout(() => {
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
