/* ============================================
   AI NetSec Academy - Enhanced Application
   Interactive Learning Platform with Advanced Features
   ============================================ */

// ============================================
// Global State
// ============================================
const AppState = {
    currentModule: null,
    theme: localStorage.getItem('theme') || 'dark',
    sidebarCollapsed: false,
    completedModules: JSON.parse(localStorage.getItem('completedModules') || '[]'),
    bookmarks: JSON.parse(localStorage.getItem('bookmarks') || '[]'),
    progress: 0,
    collapsedVolumes: JSON.parse(localStorage.getItem('collapsedVolumes') || '[]'),
    lastModuleViewed: localStorage.getItem('lastModuleViewed') || null,
    volumeProgress: JSON.parse(localStorage.getItem('volumeProgress') || '{}')
};

const VOLUME_NAME_ALIASES = {
    'Volume 4: Security Operations': 'Volume 4: Security & Compliance'
};

const VOLUME_ORDER = [
    'Volume 1: Foundations',
    'Volume 2: Practical Applications',
    'Volume 3: Advanced Techniques & Production',
    'Volume 4: Security & Compliance'
];

function normalizeVolumeName(volumeName) {
    if (!volumeName) return 'Miscellaneous';
    return VOLUME_NAME_ALIASES[volumeName] || volumeName;
}

function isChapterModule(module) {
    return /^Chapter\s+\d+/i.test(module?.title || '');
}

function getChapterNumber(module) {
    const match = (module?.title || '').match(/^Chapter\s+(\d+)/i);
    return match ? Number(match[1]) : null;
}

// Safe accessor — never throws even if courseModules is not yet defined
function getCourseModules() {
    return (typeof courseModules !== 'undefined' && Array.isArray(courseModules))
        ? courseModules
        : [];
}

function getOrderedModules() {
    const modules = getCourseModules();
    if (modules.length === 0) return [];

    // Normalize inconsistent volume naming in source data.
    modules.forEach(module => {
        module.volume = normalizeVolumeName(module.volume);
    });

    return [...modules].sort((a, b) => {
        const aVolume = normalizeVolumeName(a.volume);
        const bVolume = normalizeVolumeName(b.volume);
        const aVolumeIndex = VOLUME_ORDER.indexOf(aVolume);
        const bVolumeIndex = VOLUME_ORDER.indexOf(bVolume);
        const safeAVolumeIndex = aVolumeIndex === -1 ? 999 : aVolumeIndex;
        const safeBVolumeIndex = bVolumeIndex === -1 ? 999 : bVolumeIndex;

        if (safeAVolumeIndex !== safeBVolumeIndex) {
            return safeAVolumeIndex - safeBVolumeIndex;
        }

        const aChapter = getChapterNumber(a);
        const bChapter = getChapterNumber(b);

        if (aChapter === null && bChapter !== null) return -1;
        if (aChapter !== null && bChapter === null) return 1;
        if (aChapter !== null && bChapter !== null && aChapter !== bChapter) {
            return aChapter - bChapter;
        }

        return (a.title || '').localeCompare(b.title || '');
    });
}

function getChapterModules() {
    return getOrderedModules().filter(isChapterModule);
}

// ============================================
// Initialization
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    loadModules();
    setupEventListeners();
    setupResizer();
    loadWelcomeModal();
    applyTheme();
    calculateProgress();
    updateContinueLearning();
    setupBannerParticles();
    setupContentReveal();
});

function initializeApp() {
    console.log('🛡️ AI NetSec Academy - Initializing...');
    console.log('courseModules defined:', typeof courseModules !== 'undefined');
    console.log('courseModules length:', getCourseModules().length);

    // Check if first visit
    const isFirstVisit = !localStorage.getItem('visitedBefore');
    if (isFirstVisit) {
        setTimeout(() => showWelcomeModal(), 500);
        localStorage.setItem('visitedBefore', 'true');
    }

    // Load last viewed module if exists
    if (AppState.lastModuleViewed && !isFirstVisit) {
        setTimeout(() => loadModule(AppState.lastModuleViewed), 300);
    }
}

// ============================================
// Theme Management
// ============================================
function applyTheme() {
    if (AppState.theme === 'light') {
        document.body.classList.add('light-theme');
        document.querySelector('#theme-toggle i').className = 'fas fa-sun';
    } else {
        document.body.classList.remove('light-theme');
        document.querySelector('#theme-toggle i').className = 'fas fa-moon';
    }
}

function toggleTheme() {
    AppState.theme = AppState.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', AppState.theme);
    applyTheme();
    showToast('Theme changed', `Switched to ${AppState.theme} mode`, 'success');
}

// ============================================
// Module Management with Volume Support
// ============================================
function loadModules() {
    const moduleList = document.getElementById('module-list');
    const orderedModules = getOrderedModules();

    if (!orderedModules || orderedModules.length === 0) {
        moduleList.innerHTML = '<p style="padding: 1rem; color: var(--text-secondary);">No modules found. Check console for errors.</p>';
        console.warn('No modules loaded. courseModules:', typeof courseModules !== 'undefined' ? courseModules?.length : 'UNDEFINED');
        return;
    }

    moduleList.innerHTML = '';

    // Group modules by volume
    const volumeGroups = new Map();
    orderedModules.forEach(module => {
        const volume = normalizeVolumeName(module.volume);
        if (!volumeGroups.has(volume)) {
            volumeGroups.set(volume, []);
        }
        volumeGroups.get(volume).push(module);
    });

    // Create volume groups with collapsible sections
    const orderedVolumeNames = [
        ...VOLUME_ORDER.filter(name => volumeGroups.has(name)),
        ...[...volumeGroups.keys()].filter(name => !VOLUME_ORDER.includes(name)).sort()
    ];

    orderedVolumeNames.forEach((volumeName) => {
        const volumeElement = createVolumeGroup(volumeName, volumeGroups.get(volumeName));
        moduleList.appendChild(volumeElement);
    });

    // Load first module by default if no last viewed
    if (!AppState.lastModuleViewed && orderedModules[0]) {
        loadModule(orderedModules[0].id);
    }
}

function createVolumeGroup(volumeName, modules) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'module-group';
    groupDiv.dataset.volumeName = volumeName;

    if (AppState.collapsedVolumes.includes(volumeName)) {
        groupDiv.classList.add('collapsed');
    }

    const completedInVolume = modules.filter(m => AppState.completedModules.includes(m.id)).length;

    const titleDiv = document.createElement('div');
    titleDiv.className = 'module-group-title';
    titleDiv.innerHTML = `
        <div class="volume-header">
            <i class="fas fa-book volume-icon"></i>
            <span class="volume-title">${volumeName}</span>
        </div>
        <div class="volume-stats">
            <span class="volume-progress-badge">${completedInVolume}/${modules.length}</span>
            <i class="fas fa-chevron-down collapse-icon"></i>
        </div>
    `;

    titleDiv.addEventListener('click', () => toggleVolumeCollapse(groupDiv, volumeName));
    groupDiv.appendChild(titleDiv);

    const moduleListDiv = document.createElement('div');
    moduleListDiv.className = 'module-list';

    modules.forEach((module, index) => {
        const moduleItem = createModuleItem(module, index + 1, modules.length);
        moduleListDiv.appendChild(moduleItem);
    });

    groupDiv.appendChild(moduleListDiv);
    return groupDiv;
}

function toggleVolumeCollapse(groupDiv, volumeName) {
    groupDiv.classList.toggle('collapsed');

    if (groupDiv.classList.contains('collapsed')) {
        if (!AppState.collapsedVolumes.includes(volumeName)) {
            AppState.collapsedVolumes.push(volumeName);
        }
    } else {
        AppState.collapsedVolumes = AppState.collapsedVolumes.filter(v => v !== volumeName);
    }

    localStorage.setItem('collapsedVolumes', JSON.stringify(AppState.collapsedVolumes));
}

function createModuleItem(module, chapterNumber, totalChapters) {
    const item = document.createElement('div');
    item.className = 'module-item';
    item.dataset.moduleId = module.id;

    const isCompleted = AppState.completedModules.includes(module.id);
    if (isCompleted) item.classList.add('completed');

    let iconClass = 'fa-circle';
    let iconStyle = 'icon-networking';

    if (isCompleted) {
        iconClass = 'fa-check-circle';
        iconStyle = 'icon-security';
    } else if (module.icon) {
        iconClass = module.icon;
    }

    const chapterId = getChapterNumber(module);
    const chapterLabel = chapterId ? `Ch ${chapterId}` : 'Intro';
    const estimatedHours = chapterId ? Math.max(1, Math.ceil(chapterId * 0.2)) : 1;
    const estimatedTime = `~${estimatedHours}h`;

    item.innerHTML = `
        <div class="chapter-number">${chapterLabel}</div>
        <div class="module-icon ${iconStyle}"><i class="fas ${iconClass}"></i></div>
        <div class="module-content">
            <div class="module-title">${module.title}</div>
            <div class="module-meta">
                <span class="time-estimate">
                    <i class="fas fa-clock"></i> ${estimatedTime}
                </span>
                ${module.colabNotebook ? '<span class="notebook-badge module-badge">Notebook</span>' : ''}
                ${isCompleted ? '<span class="completed-badge module-badge">✓ Done</span>' : ''}
            </div>
        </div>
    `;

    item.addEventListener('click', () => loadModule(module.id));
    return item;
}

// Content cache for modules with lazy-loaded contentUrl
const _contentCache = new Map();

async function loadModuleContent(module) {
    if (module.theory) return module.theory;
    if (!module.contentUrl) return '# No content available.';
    if (_contentCache.has(module.contentUrl)) return _contentCache.get(module.contentUrl);
    const resp = await fetch(module.contentUrl);
    if (!resp.ok) throw new Error('Content fetch failed: ' + resp.statusText);
    const text = await resp.text();
    _contentCache.set(module.contentUrl, text);
    return text;
}

async function loadModule(moduleId) {
    showLoading();

    try {
        // Safe access — throws ReferenceError if courseModules not defined
        const modules = getCourseModules();
        const module = modules.find(m => m.id === moduleId);

        if (!module) {
            console.error('Module not found:', moduleId);
            hideLoading();
            return;
        }

        AppState.currentModule = module;
        AppState.lastModuleViewed = moduleId;
        localStorage.setItem('lastModuleViewed', moduleId);

        const theory = await loadModuleContent(module);
        updateModuleUI(module, theory);

        // Update active state in sidebar
        document.querySelectorAll('.module-item').forEach(item => {
            item.classList.remove('active');
            if (item.dataset.moduleId === moduleId) {
                item.classList.add('active');
                item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });

        updateContinueLearning();

    } catch (err) {
        console.error('Failed to load module:', err);
        document.getElementById('theory-content').innerHTML =
            `<p style="color:var(--text-secondary);padding:2rem;">Failed to load content: ${err.message}. Please refresh the page.</p>`;
    } finally {
        // Always hide spinner — no matter what goes wrong
        setTimeout(hideLoading, 300);
    }
}

function updateModuleUI(module, theory) {
    // Update banner volume badge
    const bannerVolume = document.getElementById('banner-volume');
    if (bannerVolume) bannerVolume.textContent = module.volume || 'Course Content';

    animateBannerTitle(module.title);

    const theoryContent = document.getElementById('theory-content');
    const chapterInfo = createChapterInfoCard(module);

    // Guard marked — fall back to plain text if CDN failed to load
    const rawTheory = theory || module.theory || '# Loading...';
    const theoryMarkdown = (typeof marked !== 'undefined')
        ? marked.parse(rawTheory)
        : `<pre style="white-space:pre-wrap;padding:1rem">${rawTheory}</pre>`;

    theoryContent.innerHTML = chapterInfo + theoryMarkdown;

    // Apply syntax highlighting only if hljs loaded
    if (typeof hljs !== 'undefined') {
        theoryContent.querySelectorAll('pre code').forEach(block => {
            hljs.highlightElement(block);
        });
    }

    // Build code cards from theory
    buildCodeCards(theoryContent);

    // Visual enhancements
    transformCallouts(theoryContent);
    addCopyButtons(theoryContent);
    applyRevealAnimation(theoryContent);
    updateTabBadges(module, theoryContent);
    updateColabBanner(module);

    // Reset to concept tab on module change
    switchLearningTab('concept');

    // Load notebook (also triggered lazily when Lab tab is clicked)
    if (typeof notebookLoader !== 'undefined' && module.colabNotebook) {
        notebookLoader.loadCurrentNotebook();
    } else if (typeof notebookLoader !== 'undefined') {
        notebookLoader.showNoNotebookMessage();
    }

    theoryContent.scrollTop = 0;
}

function createChapterInfoCard(module) {
    const orderedModules = getOrderedModules();
    const chapterModules = orderedModules.filter(isChapterModule);
    const chapterNumber = getChapterNumber(module);
    const estimatedTime = `${chapterNumber ? Math.max(1, Math.ceil(chapterNumber * 0.2)) : 1} hours`;
    const chapterLabel = chapterNumber ? `Chapter ${chapterNumber} of ${chapterModules.length}` : `Volume Introduction`;

    return `
        <div class="chapter-info">
            <div class="chapter-info-header">
                <div class="chapter-info-title">Chapter Information</div>
            </div>
            <div class="chapter-info-content">
                <div class="info-item">
                    <i class="fas fa-book"></i>
                    <span>${module.volume || 'Course Content'}</span>
                </div>
                <div class="info-item">
                    <i class="fas fa-clock"></i>
                    <span>${estimatedTime}</span>
                </div>
                ${module.colabNotebook ? `
                <div class="info-item">
                    <i class="fab fa-google"></i>
                    <span>Interactive Notebook</span>
                </div>
                ` : ''}
                <div class="info-item">
                    <i class="fas fa-graduation-cap"></i>
                    <span>${chapterLabel}</span>
                </div>
            </div>
        </div>
    `;
}

// ============================================
// Progress & Completion
// ============================================
function completeModule() {
    if (!AppState.currentModule) return;

    const moduleId = AppState.currentModule.id;

    if (!AppState.completedModules.includes(moduleId)) {
        AppState.completedModules.push(moduleId);
        localStorage.setItem('completedModules', JSON.stringify(AppState.completedModules));

        updateVolumeProgress(AppState.currentModule.volume);

        const moduleItem = document.querySelector(`[data-module-id="${moduleId}"]`);
        if (moduleItem) {
            moduleItem.classList.add('completed');
            const icon = moduleItem.querySelector('.module-icon i');
            if (icon) icon.className = 'fas fa-check-circle';

            const meta = moduleItem.querySelector('.module-meta');
            if (meta && !meta.querySelector('.completed-badge')) {
                const badge = document.createElement('span');
                badge.className = 'completed-badge module-badge';
                badge.textContent = '✓ Done';
                meta.appendChild(badge);
            }
        }

        calculateProgress();
        updateContinueLearning();
        showToast('Chapter completed! 🎉', AppState.currentModule.title, 'success');
        triggerCelebration();
        setTimeout(() => navigateModule('next'), 1500);
    } else {
        showToast('Already completed', 'This chapter is already marked as complete', 'info');
    }
}

function updateVolumeProgress(volumeName) {
    const modules = getCourseModules();
    const volumeModules = modules.filter(m => m.volume === volumeName);
    const completedInVolume = volumeModules.filter(m => AppState.completedModules.includes(m.id)).length;

    AppState.volumeProgress[volumeName] = {
        completed: completedInVolume,
        total: volumeModules.length,
        percentage: Math.round((completedInVolume / volumeModules.length) * 100)
    };

    localStorage.setItem('volumeProgress', JSON.stringify(AppState.volumeProgress));

    const volumeGroup = document.querySelector(`[data-volume-name="${volumeName}"]`);
    if (volumeGroup) {
        const badge = volumeGroup.querySelector('.volume-progress-badge');
        if (badge) badge.textContent = `${completedInVolume}/${volumeModules.length}`;
    }
}

function calculateProgress() {
    const chapterModules = getChapterModules();
    const totalModules = chapterModules.length;
    const completedCount = chapterModules.filter(m => AppState.completedModules.includes(m.id)).length;
    AppState.progress = totalModules > 0 ? Math.round((completedCount / totalModules) * 100) : 0;
    updateProgressUI();
}

function updateProgressUI() {
    const chapterModules = getChapterModules();
    const totalChapters = chapterModules.length;
    const completedCount = chapterModules.filter(m => AppState.completedModules.includes(m.id)).length;
    const notebookCount = chapterModules.filter(m => Boolean(m.colabNotebook)).length;

    document.getElementById('overall-progress').textContent = `${AppState.progress}%`;
    document.getElementById('progress-fill').style.width = `${AppState.progress}%`;
    document.getElementById('completed-chapters').textContent = completedCount;

    const totalChaptersEl = document.getElementById('total-chapters');
    if (totalChaptersEl) totalChaptersEl.textContent = `${totalChapters}`;

    const welcomeChapterStat = document.getElementById('welcome-stat-chapters');
    if (welcomeChapterStat) welcomeChapterStat.textContent = `${totalChapters} Chapters`;

    const welcomeNotebookStat = document.getElementById('welcome-stat-notebooks');
    if (welcomeNotebookStat) welcomeNotebookStat.textContent = `${notebookCount} Notebooks`;

    const remainingHours = Math.ceil(Math.max(0, totalChapters - completedCount) * 1.5);
    document.getElementById('time-remaining').textContent = `~${remainingHours}h`;
}

function updateContinueLearning() {
    const continueSection = document.getElementById('continue-learning');

    if (!AppState.lastModuleViewed) {
        continueSection.style.display = 'none';
        return;
    }

    const modules = getCourseModules();
    const lastModule = modules.find(m => m.id === AppState.lastModuleViewed);
    if (!lastModule) {
        continueSection.style.display = 'none';
        return;
    }

    const chapterNumber = getChapterNumber(lastModule);
    const chapterText = chapterNumber ? `Chapter ${chapterNumber}` : 'Volume Intro';

    document.getElementById('continue-chapter-title').textContent = lastModule.title;
    document.getElementById('continue-chapter-progress').innerHTML = `${chapterText} • ${lastModule.volume}`;

    continueSection.style.display = 'block';
    continueSection.onclick = () => loadModule(lastModule.id);
}

// ============================================
// Navigation
// ============================================
function navigateModule(direction) {
    if (!AppState.currentModule) return;

    const orderedModules = getOrderedModules();
    const currentIndex = orderedModules.findIndex(m => m.id === AppState.currentModule.id);

    if (direction === 'next' && currentIndex < orderedModules.length - 1) {
        loadModule(orderedModules[currentIndex + 1].id);
    } else if (direction === 'prev' && currentIndex > 0) {
        loadModule(orderedModules[currentIndex - 1].id);
    } else {
        const msg = direction === 'next' ? 'This is the last chapter' : 'This is the first chapter';
        showToast('End reached', msg, 'info');
    }
}

// ============================================
// Bookmarks
// ============================================
function toggleBookmark() {
    if (!AppState.currentModule) return;

    const moduleId = AppState.currentModule.id;
    const index = AppState.bookmarks.indexOf(moduleId);

    if (index === -1) {
        AppState.bookmarks.push(moduleId);
        document.querySelector('#bookmark-btn i').className = 'fas fa-bookmark';
        showToast('Bookmarked', 'Chapter added to bookmarks', 'success');
    } else {
        AppState.bookmarks.splice(index, 1);
        document.querySelector('#bookmark-btn i').className = 'far fa-bookmark';
        showToast('Removed', 'Bookmark removed', 'info');
    }

    localStorage.setItem('bookmarks', JSON.stringify(AppState.bookmarks));
}

// ============================================
// Search & Filter
// ============================================
function searchModules(query) {
    const items = document.querySelectorAll('.module-item');
    const volumes = document.querySelectorAll('.module-group');

    if (!query.trim()) {
        items.forEach(item => item.style.display = 'flex');
        volumes.forEach(vol => vol.style.display = 'block');
        return;
    }

    const lowerQuery = query.toLowerCase();
    items.forEach(item => {
        const title = item.querySelector('.module-title').textContent.toLowerCase();
        item.style.display = title.includes(lowerQuery) ? 'flex' : 'none';
    });

    volumes.forEach(vol => {
        const visible = Array.from(vol.querySelectorAll('.module-item')).filter(i => i.style.display !== 'none');
        vol.style.display = visible.length > 0 ? 'block' : 'none';
    });
}

function setAllVolumesCollapsed(shouldCollapse) {
    document.querySelectorAll('.module-group').forEach(group => {
        const volumeName = group.dataset.volumeName;
        group.classList.toggle('collapsed', shouldCollapse);

        if (shouldCollapse) {
            if (!AppState.collapsedVolumes.includes(volumeName)) AppState.collapsedVolumes.push(volumeName);
        } else {
            AppState.collapsedVolumes = AppState.collapsedVolumes.filter(v => v !== volumeName);
        }
    });
    localStorage.setItem('collapsedVolumes', JSON.stringify(AppState.collapsedVolumes));
}

function filterNotebookModules() {
    const modules = getCourseModules();
    document.querySelectorAll('.module-item').forEach(item => {
        const module = modules.find(m => m.id === item.dataset.moduleId);
        item.style.display = module?.colabNotebook ? 'flex' : 'none';
    });
    document.querySelectorAll('.module-group').forEach(vol => {
        const visible = Array.from(vol.querySelectorAll('.module-item')).filter(i => i.style.display !== 'none');
        vol.style.display = visible.length > 0 ? 'block' : 'none';
    });
}

function handleTopNav(section) {
    const searchInput = document.getElementById('module-search');

    if (section === 'home') {
        const orderedModules = getOrderedModules();
        if (orderedModules[0]) loadModule(orderedModules[0].id);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        showToast('Home', 'Returned to course start', 'info');
        return;
    }
    if (section === 'curriculum') {
        if (searchInput) searchInput.value = '';
        searchModules('');
        setAllVolumesCollapsed(false);
        showToast('Curriculum', 'Showing all volumes and chapters', 'info');
        return;
    }
    if (section === 'notebooks') {
        if (searchInput) searchInput.value = '';
        searchModules('');
        setAllVolumesCollapsed(false);
        filterNotebookModules();
        showToast('Notebooks', 'Showing chapters with interactive notebooks', 'info');
        return;
    }
    if (section === 'paths') {
        showToast('Learning Paths', 'Path-specific filtering coming soon.', 'info');
    }
}

// ============================================
// Split Screen Resizer
// ============================================
function setupResizer() {
    const resizer = document.getElementById('resizer');
    const leftPanel = document.querySelector('.panel-left');
    const rightPanel = document.querySelector('.panel-right');
    let isResizing = false;

    resizer.addEventListener('mousedown', () => {
        isResizing = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const container = document.querySelector('.content-wrapper');
        const containerRect = container.getBoundingClientRect();
        const leftWidth = e.clientX - containerRect.left;
        const totalWidth = containerRect.width;
        if (leftWidth > 300 && leftWidth < totalWidth - 300) {
            leftPanel.style.flex = `0 0 ${(leftWidth / totalWidth) * 100}%`;
            rightPanel.style.flex = `0 0 ${((totalWidth - leftWidth) / totalWidth) * 100}%`;
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });
}

// ============================================
// Modals
// ============================================
function showWelcomeModal() {
    document.getElementById('welcome-modal').classList.add('active');
}

function loadWelcomeModal() {
    const modal = document.getElementById('welcome-modal');
    if (!modal) return;

    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', (e) => { e.stopPropagation(); modal.classList.remove('active'); });
    });

    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });

    document.getElementById('start-learning')?.addEventListener('click', (e) => {
        e.stopPropagation();
        modal.classList.remove('active');
        const orderedModules = getOrderedModules();
        if (orderedModules[0]) loadModule(orderedModules[0].id);
    });

    document.getElementById('take-tour')?.addEventListener('click', (e) => {
        e.stopPropagation();
        modal.classList.remove('active');
        showToast('Tour feature', 'Interactive tour coming soon!', 'info');
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) modal.classList.remove('active');
    });
}

// ============================================
// Utilities
// ============================================
function showLoading() {
    document.getElementById('loading-overlay').classList.add('active');
}

function hideLoading() {
    document.getElementById('loading-overlay').classList.remove('active');
}

function showToast(title, message, type = 'info') {
    const container = document.getElementById('toast-container');
    const icons = { success: 'fa-check-circle', warning: 'fa-exclamation-triangle', error: 'fa-times-circle', info: 'fa-info-circle' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="fas ${icons[type]} toast-icon"></i>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>
    `;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'slideInRight 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen()
            .then(() => { document.querySelector('#fullscreen-toggle i').className = 'fas fa-compress'; })
            .catch(() => { showToast('Fullscreen unavailable', 'Browser blocked fullscreen request', 'warning'); });
    } else {
        document.exitFullscreen()
            .then(() => { document.querySelector('#fullscreen-toggle i').className = 'fas fa-expand'; })
            .catch(() => {});
    }
}

function toggleSidebar() {
    AppState.sidebarCollapsed = !AppState.sidebarCollapsed;
    document.getElementById('sidebar').classList.toggle('collapsed');
}

function shareModule() {
    if (!AppState.currentModule) return;
    const url = `${window.location.origin}${window.location.pathname}?module=${AppState.currentModule.id}`;
    if (navigator.share) {
        navigator.share({ title: `AI NetSec Academy - ${AppState.currentModule.title}`, url }).catch(() => {});
    } else {
        navigator.clipboard.writeText(url)
            .then(() => showToast('Link copied', 'Chapter link copied to clipboard', 'success'))
            .catch(() => showToast('Share link', url, 'info'));
    }
}

// ============================================
// Event Listeners
// ============================================
function setupEventListeners() {
    setupLearningTabs();
    document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
    document.getElementById('fullscreen-toggle')?.addEventListener('click', toggleFullscreen);
    document.getElementById('sidebar-toggle')?.addEventListener('click', toggleSidebar);
    document.getElementById('module-search')?.addEventListener('input', (e) => searchModules(e.target.value));

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => handleTopNav(btn.dataset.section));
    });

    document.getElementById('prev-module')?.addEventListener('click', () => navigateModule('prev'));
    document.getElementById('next-module')?.addEventListener('click', () => navigateModule('next'));
    document.getElementById('complete-module')?.addEventListener('click', completeModule);
    document.getElementById('bookmark-btn')?.addEventListener('click', toggleBookmark);
    document.getElementById('print-btn')?.addEventListener('click', () => window.print());
    document.getElementById('share-btn')?.addEventListener('click', shareModule);
    document.getElementById('help-fab')?.addEventListener('click', () => showToast('Help', 'Documentation coming soon!', 'info'));
    document.getElementById('chat-fab')?.addEventListener('click', () => showToast('AI Assistant', 'Chat feature coming soon!', 'info'));

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); toggleSidebar(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); document.getElementById('module-search')?.focus(); }
    });
}


// ============================================
// Tabbed Learning Layout
// ============================================
function setupLearningTabs() {
    document.querySelectorAll('.ltab').forEach(tab => {
        tab.addEventListener('click', () => switchLearningTab(tab.dataset.tab));
    });
}

function switchLearningTab(tabName) {
    document.querySelectorAll('.ltab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

    const targetTab   = document.querySelector(`.ltab[data-tab="${tabName}"]`);
    const targetPanel = document.getElementById(`tab-${tabName}`);

    if (targetTab)   targetTab.classList.add('active');
    if (targetPanel) targetPanel.classList.add('active');

    // Lazy-init notebook when Lab tab is opened
    if (tabName === 'lab' && AppState.currentModule) {
        if (typeof notebookLoader !== 'undefined' && AppState.currentModule.colabNotebook) {
            notebookLoader.loadCurrentNotebook();
            // Auto-open Colab in new tab when Lab is clicked
            notebookLoader.openInColab();
        } else if (typeof notebookLoader !== 'undefined') {
            notebookLoader.showNoNotebookMessage();
        }
    }
}

// ============================================
// Code Explanation Engine (Junior-friendly)
// Generated for: AI NetSec Academy
// ============================================

function generateCodeExplanation(code, lang) {
    if (!code.trim()) return null;
    const lower  = code.toLowerCase();
    const hasPy  = !lang || lang === 'python' || lang === 'py' || lang === '';
    if (!hasPy) return null;   // skip bash/json/ios/text blocks

    // ── Overview: what does this block do? ───────────────────────
    let overview = 'A Python code example from this chapter — read the inline <code>#</code> comments for step-by-step context.';

    if (/system_prompt\s*=/.test(lower) || /you are a network/.test(lower)) {
        overview = 'Defines the <strong>system prompt</strong> — Claude\'s "job description". This text is sent once at the start of every session as a <code>system</code> role message. It controls Claude\'s persona, constraints, and output format for every response that follows.';
    } else if (/thought:|action:|params:/.test(lower)) {
        overview = 'Shows the <strong>ReAct output format</strong> Claude must follow: THOUGHT (reasoning step), ACTION (which tool to call), PARAMS (arguments). Your Python code then parses this structured text and calls the matching function.';
    } else if (/from anthropic import/.test(lower) && /def ping|def run_show|demo_data/.test(lower)) {
        overview = 'Sets up <strong>imports, the Anthropic client, and network tool functions</strong> — the three things every agent needs before it can start working.';
    } else if (/from anthropic import/.test(lower)) {
        overview = 'Imports and configures the <strong>Anthropic client</strong> — the object you use to call Claude. Install once with <code>pip install anthropic</code>, then use it for every API call.';
    } else if (/client\.messages\.create/.test(lower)) {
        overview = 'Makes a <strong>live API call to Claude</strong> — sends the full conversation history and receives Claude\'s response. This is the "AI thinking" step. Everything in the <code>messages</code> list is what Claude sees.';
    } else if (/@dataclass/.test(lower)) {
        overview = 'Uses Python\'s <strong>@dataclass decorator</strong> to define a data structure. Instead of writing a full <code>__init__</code> method by hand, <code>@dataclass</code> generates it automatically from the field definitions.';
    } else if (/class toolcategory|class.*\(enum\)/.test(lower)) {
        overview = 'Defines a <strong>Python Enum</strong> — a named set of constants. Using <code>ToolCategory.READ</code> is safer than the raw string <code>"read"</code> because Python will raise an error if you mistype the name.';
    } else if (/auto_approve_reads|execute_with_approval/.test(lower)) {
        overview = 'Implements <strong>human-in-the-loop safety</strong>: READ tools (show commands) run automatically, WRITE tools (config changes) pause and ask a human to approve before executing. This prevents the agent from accidentally changing production config.';
    } else if (/demo_data\s*=\s*\{/.test(lower)) {
        overview = 'Provides <strong>mock device data</strong> — a Python dictionary that maps <code>(device, command)</code> to realistic CLI output. Lets you build and test the full agent without connecting to real hardware.';
    } else if (/def ping_device|def run_show|def get_ospf|def fetch_route/.test(lower)) {
        overview = 'Implements a <strong>network tool function</strong>. The agent never talks to devices directly — it always calls a function like this one. The function either hits a real device or returns demo data depending on <code>DEMO_MODE</code>.';
    } else if (/stategraph|add_node/.test(lower)) {
        overview = 'Builds the <strong>LangGraph agent workflow</strong>: registers each step (observe, reason, act) as a graph node, then connects them with edges. The graph decides what runs next based on the current state.';
    } else if (/graph\.compile/.test(lower)) {
        overview = '<strong>Compiles and runs the agent</strong>. <code>graph.compile()</code> validates the graph and returns an executable object. Then <code>app.invoke({state})</code> runs your agent from the entry point to the end.';
    } else if (/chromadb|collection\.add/.test(lower)) {
        overview = 'Stores data in <strong>ChromaDB</strong> — a local vector database. <code>collection.add()</code> converts text to a number-array (embedding) and stores it. Later, <code>collection.query()</code> finds the most similar stored entries to a search string.';
    } else if (/collection\.query|n_results/.test(lower)) {
        overview = '<strong>Queries the vector database</strong> to find past incidents similar to the current problem. ChromaDB converts your query to an embedding and returns the N stored entries with the closest meaning.';
    } else if (/@app\.(get|post|put)/.test(lower)) {
        overview = 'Defines a <strong>FastAPI route</strong> — an HTTP endpoint that lets external tools (monitoring platforms, ticketing systems) call your agent via a REST API. The decorator registers the URL and HTTP method.';
    } else if (/prometheus|counter\(|gauge\(/.test(lower)) {
        overview = 'Sets up <strong>Prometheus metrics</strong> to track agent health in production: how many tickets it processed, how often it succeeded, how long each step took. These are scraped by Prometheus and displayed in Grafana.';
    } else if (/for step in range|while.*max_steps/.test(lower)) {
        overview = 'Implements the <strong>agent ReAct loop</strong> — runs observe → reason → act repeatedly. Each iteration the agent gathers new evidence and refines its analysis until it reaches a conclusion or hits the max-steps safety limit.';
    } else if (/messages\s*=\s*\[/.test(lower) && /"role"/.test(lower)) {
        overview = 'Builds the <strong>messages list</strong> that gets sent to Claude. Each entry has a <code>role</code> (who\'s speaking) and <code>content</code> (what they said). Claude sees the entire list on every call — there\'s no built-in memory between calls.';
    } else if (/chatanthropic|claude-sonnet|claude-haiku/.test(lower)) {
        overview = 'Creates the <strong>Claude model instance</strong>. Different agent nodes can use different Claude tiers — Haiku for simple decisions (cheap + fast), Sonnet for deep reasoning. Mixing tiers reduces cost by 40-60% with no accuracy loss.';
    } else if (/async def/.test(lower)) {
        overview = 'Uses <strong>async/await</strong> — Python\'s way of handling multiple waiting operations concurrently. Instead of blocking while waiting for an API call to return, async functions yield control so other work can run in parallel.';
    }

    // ── Key concept bullets ───────────────────────────────────────
    const bullets = [];

    // --- Import bullets ---
    if (/from anthropic import anthropic/i.test(lower)) {
        bullets.push({ icon: '📦', text: '<code>Anthropic</code> — the official Anthropic Python client. Create one instance at startup: <code>client = Anthropic()</code> (reads <code>ANTHROPIC_API_KEY</code> from your environment). Reuse it for every API call.' });
    }
    if (/from langchain_anthropic/.test(lower)) {
        bullets.push({ icon: '📦', text: '<code>langchain_anthropic</code> — wraps Claude in LangChain\'s unified interface. Needed for LangGraph because it expects a standard <code>BaseChatModel</code> object, not the raw Anthropic client.' });
    }
    if (/from langgraph/.test(lower)) {
        bullets.push({ icon: '📦', text: '<code>langgraph</code> — builds agent workflows as directed graphs. Each node is a Python function; edges define what runs next. Much cleaner than a manual while-loop with if/elif branching.' });
    }
    if (/import chromadb/.test(lower)) {
        bullets.push({ icon: '📦', text: '<code>chromadb</code> — runs a vector database locally (no server needed). Install: <code>pip install chromadb</code>. Stores text as number-arrays (embeddings) and finds the most similar stored entries in milliseconds.' });
    }
    if (/from fastapi import/.test(lower)) {
        bullets.push({ icon: '📦', text: '<code>fastapi</code> — modern async web framework. Automatically validates request bodies, generates API docs at <code>/docs</code>, and handles async natively. Much faster to write than Flask.' });
    }
    if (/from enum import enum/i.test(lower)) {
        bullets.push({ icon: '🏷️', text: '<code>Enum</code> — create a named constant set. Benefit: Python raises <code>AttributeError</code> if you mistype <code>ToolCategory.RAED</code>, whereas the raw string <code>"raed"</code> silently passes through.' });
    }
    if (/@dataclass/.test(lower)) {
        bullets.push({ icon: '🏗️', text: '<code>@dataclass</code> auto-generates <code>__init__</code>, <code>__repr__</code>, and <code>__eq__</code>. Without it you write 10+ lines of boilerplate. Fields become constructor parameters in the order they\'re declared.' });
    }
    if (/from typing import/.test(lower)) {
        bullets.push({ icon: '📝', text: '<code>Optional[str]</code> = either a string or <code>None</code>. <code>List[dict]</code> = a list of dictionaries. <code>Any</code> = any type. Python ignores these at runtime but your IDE flags mismatches before you run the code.' });
    }

    // --- LLM / API bullets ---
    if (/system_prompt\s*=/.test(lower)) {
        bullets.push({ icon: '🎯', text: '<strong>SYSTEM_PROMPT</strong> shapes every response in the session. Change the system prompt → completely different agent behavior. Keep it specific: define the persona, list the tools, specify the exact output format Claude must use.' });
    }
    if (/\{tool_descriptions\}/.test(code)) {
        bullets.push({ icon: '🔧', text: '<code>{tool_descriptions}</code> is a Python <code>.format()</code> placeholder. At runtime: <code>SYSTEM_PROMPT.format(tool_descriptions=describe_tools(TOOLS))</code>. This injects the current tool list so Claude knows what actions it can take.' });
    }
    if (/temperature\s*=\s*0/.test(lower)) {
        bullets.push({ icon: '🎲', text: '<strong>temperature=0</strong> removes all randomness — same input always produces the same output. Critical for automation and auditing. Only raise temperature for creative tasks like generating documentation or test cases.' });
    }
    if (/max_tokens/.test(lower)) {
        bullets.push({ icon: '📏', text: '<code>max_tokens</code> caps response length. 1 token ≈ ¾ of an English word. A typical OSPF analysis: ~400 tokens. A full routing table: ~2000 tokens. Set it high enough but cap it to prevent runaway responses.' });
    }
    if (/"role":\s*"system"/.test(lower)) {
        bullets.push({ icon: '🎭', text: '<strong>role "system"</strong> — Claude\'s standing instruction, sent once before any conversation. Think of it as the brief you give a new engineer on their first day. Everything else in the conversation builds on top of this.' });
    }
    if (/"role":\s*"user"/.test(lower)) {
        bullets.push({ icon: '👤', text: '<strong>role "user"</strong> — in agents, "user" carries both human input AND tool output. When a show-command returns data, you inject it as a user message. Claude treats it all as incoming information.' });
    }
    if (/"role":\s*"assistant"/.test(lower)) {
        bullets.push({ icon: '🤖', text: '<strong>role "assistant"</strong> — Claude\'s previous replies. You must replay the full history on every call because there is no server-side memory between calls. Without these, Claude starts fresh and forgets what it already reasoned.' });
    }
    if (/\.content\[0\]\.text/.test(lower)) {
        bullets.push({ icon: '📨', text: '<code>response.content[0].text</code> — the API returns a list of content blocks (usually one text block). <code>[0]</code> gets the first block; <code>.text</code> extracts the string. Always check <code>response.stop_reason == "end_turn"</code>.' });
    }

    // --- Tool / Safety bullets ---
    if (/demo_mode\s*=\s*true/i.test(lower)) {
        bullets.push({ icon: '🧪', text: '<strong>DEMO_MODE = True</strong> — returns fake device data instead of making real SSH connections. Flip to <code>False</code> when connecting to real hardware. Always start with True during development.' });
    }
    if (/demo_data/.test(lower) && /\{/.test(lower)) {
        bullets.push({ icon: '📋', text: '<strong>DEMO_DATA</strong> is a Python dict with tuple keys: <code>(device_name, command)</code> maps to a realistic CLI output string. This mirrors what Netmiko returns from a real device over SSH.' });
    }
    if (/toolresult|class toolresult/.test(lower)) {
        bullets.push({ icon: '📤', text: '<code>ToolResult</code> — standardized return type for every tool. Always has <code>success: bool</code>, <code>data: Any</code>, and optionally <code>error: str</code>. Consistent structure means one error-handling pattern works for all tools.' });
    }
    if (/auto_approve_reads/.test(lower)) {
        bullets.push({ icon: '🛡️', text: '<strong>Human-in-the-loop</strong>: READ tools run automatically (just fetching data — safe). WRITE tools stop and print what they\'re about to do, then wait for a human to type "yes". Prevents runaway config changes in production.' });
    }

    // --- LangGraph bullets ---
    if (/add_node/.test(lower)) {
        bullets.push({ icon: '🔵', text: '<code>graph.add_node("name", fn)</code> — registers a step. The function <code>fn</code> receives the current state dict and returns an updated state dict. LangGraph passes the state automatically between nodes.' });
    }
    if (/add_edge/.test(lower)) {
        bullets.push({ icon: '➡️', text: '<code>graph.add_edge("a", "b")</code> — after node A finishes, always run node B. For branching logic, use <code>add_conditional_edges</code> with a router function that returns the next node name.' });
    }
    if (/graph\.compile/.test(lower)) {
        bullets.push({ icon: '⚙️', text: '<code>graph.compile()</code> validates and locks the graph into an executable object. After this, call <code>app.invoke(initial_state)</code> to start the agent. The graph runs until it reaches <code>END</code> or raises an exception.' });
    }

    // --- Vector DB bullets ---
    if (/collection\.add/.test(lower)) {
        bullets.push({ icon: '💾', text: '<code>collection.add(documents=[...], ids=[...])</code> — ChromaDB automatically converts each string to a vector (embedding) and stores it. The <code>ids</code> must be unique strings — use ticket numbers or timestamps.' });
    }
    if (/collection\.query/.test(lower)) {
        bullets.push({ icon: '🔍', text: '<code>collection.query(query_texts=["..."], n_results=3)</code> — converts your query to an embedding and returns the 3 stored documents with the closest vectors. The smaller the distance, the more semantically similar.' });
    }

    // --- Async bullets ---
    if (/async def/.test(lower)) {
        bullets.push({ icon: '⚡', text: '<code>async def</code> declares a coroutine — a function that can pause at <code>await</code> points. While waiting for an API response, other async tasks run. Use <code>asyncio.run(fn())</code> to call it from regular (sync) code.' });
    }

    // --- General Python bullets ---
    if (/try:/.test(lower) && /except/.test(lower)) {
        bullets.push({ icon: '🛡️', text: '<code>try/except</code> — always wrap API calls and tool calls in try/except. Network tools fail (timeouts, unreachable devices). A caught exception lets the agent log the error and continue rather than crashing the whole run.' });
    }
    if (/f".*\{|f'.*\{/.test(code)) {
        bullets.push({ icon: '🖊️', text: '<strong>f-strings</strong> — <code>f"Checking {host} on interface {intf}"</code>. The <code>f</code> prefix activates variable interpolation inside curly braces <code>{}</code>. Cleaner and faster than <code>"..." + str(var) + "..."</code>.' });
    }
    if (/: str|: int|: dict|: list|: bool/.test(code)) {
        bullets.push({ icon: '🔠', text: '<strong>Type hints</strong> — <code>def fn(host: str, port: int) -> dict</code>. Python does not enforce them at runtime, but your IDE (VS Code, PyCharm) will highlight mismatches as you type, catching bugs before you run the code.' });
    }
    if (/\w+\s+for\s+\w+\s+in/.test(code) && /\[/.test(code)) {
        bullets.push({ icon: '🔄', text: '<strong>List comprehension</strong> — <code>[x.upper() for x in hosts if x]</code> builds a list in one line. Equivalent to a for-loop with <code>.append()</code> but more readable for simple transformations.' });
    }

    return { overview, bullets: bullets.slice(0, 5) };
}

function buildCodeCards(theoryContent) {
    const container = document.getElementById('code-cards');
    if (!container) return;

    const codeBlocks = theoryContent.querySelectorAll('pre code');

    if (codeBlocks.length === 0) {
        container.innerHTML = `
            <div class="code-empty">
                <i class="fas fa-code"></i>
                <p>No code examples in this chapter.</p>
            </div>`;
        return;
    }

    const langLabel = l => ({ python:'Python', py:'Python', javascript:'JavaScript',
        js:'JavaScript', bash:'Shell', sh:'Shell', json:'JSON', yaml:'YAML',
        html:'HTML', css:'CSS', ios:'IOS CLI', text:'Text' })[l] || (l ? l.toUpperCase() : 'Code');

    const esc = t => t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    container.innerHTML = '';

    Array.from(codeBlocks).forEach((block, i) => {
        const langClass = block.className || '';
        const lang = (langClass.match(/language-([\w-]+)/) || [])[1] || '';

        // ── Wrap code card + explanation in a unit ──────────────
        const unit = document.createElement('div');
        unit.className = 'code-block-unit';

        // Code card
        const card = document.createElement('div');
        card.className = 'code-card';
        card.innerHTML =
            `<div class="code-card-header">` +
            `<span class="code-card-label">Example ${i + 1}</span>` +
            `<span class="code-card-lang">${langLabel(lang)}</span>` +
            `</div>` +
            `<pre><code class="${langClass}">${esc(block.textContent)}</code></pre>`;
        unit.appendChild(card);

        // Explanation card
        const expl = generateCodeExplanation(block.textContent, lang);
        if (expl && (expl.overview || expl.bullets.length > 0)) {
            const bulletsHtml = expl.bullets.map(b =>
                `<div class="explain-bullet">` +
                `<span class="explain-icon">${b.icon}</span>` +
                `<span class="explain-text">${b.text}</span>` +
                `</div>`
            ).join('');

            const explCard = document.createElement('div');
            explCard.className = 'code-explain-card';
            explCard.innerHTML =
                `<div class="explain-label"><i class="fas fa-graduation-cap"></i> What this code does</div>` +
                `<div class="explain-overview">${expl.overview}</div>` +
                (expl.bullets.length > 0 ? `<div class="explain-bullets">${bulletsHtml}</div>` : '');
            unit.appendChild(explCard);
        }

        container.appendChild(unit);
    });

    if (typeof hljs !== 'undefined') {
        container.querySelectorAll('pre code').forEach(b => hljs.highlightElement(b));
    }
    addCopyButtons(container);
}



// ============================================
// Visual Upgrade — Dynamic Learning UI
// ============================================

// ── Banner Particle Network ───────────────────
function setupBannerParticles() {
    const banner = document.getElementById('module-banner');
    if (!banner) return;
    requestAnimationFrame(() => {
        const canvas = document.createElement('canvas');
        canvas.id = 'banner-canvas';
        banner.insertBefore(canvas, banner.firstChild);
        const ctx = canvas.getContext('2d');
        let W, H, nodes;
        function resize() {
            W = canvas.width  = banner.offsetWidth;
            H = canvas.height = banner.offsetHeight;
        }
        function initNodes() {
            nodes = Array.from({ length: 22 }, () => ({
                x:  Math.random() * W,
                y:  Math.random() * H,
                vx: (Math.random() - 0.5) * 0.35,
                vy: (Math.random() - 0.5) * 0.35,
                r:  Math.random() * 1.8 + 1.2
            }));
        }
        function draw() {
            ctx.clearRect(0, 0, W, H);
            for (let i = 0; i < nodes.length; i++) {
                for (let j = i + 1; j < nodes.length; j++) {
                    const dx = nodes[i].x - nodes[j].x;
                    const dy = nodes[i].y - nodes[j].y;
                    const d  = Math.hypot(dx, dy);
                    if (d < 110) {
                        ctx.beginPath();
                        ctx.moveTo(nodes[i].x, nodes[i].y);
                        ctx.lineTo(nodes[j].x, nodes[j].y);
                        ctx.strokeStyle = `rgba(99,102,241,${(1 - d / 110) * 0.55})`;
                        ctx.lineWidth = 0.7;
                        ctx.stroke();
                    }
                }
            }
            nodes.forEach(n => {
                ctx.beginPath();
                ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(129,140,248,0.8)';
                ctx.fill();
                n.x += n.vx;  n.y += n.vy;
                if (n.x < 0 || n.x > W) n.vx *= -1;
                if (n.y < 0 || n.y > H) n.vy *= -1;
            });
            requestAnimationFrame(draw);
        }
        resize();
        initNodes();
        draw();
        window.addEventListener('resize', () => { resize(); initNodes(); });
    });
}

// ── Content Reveal (IntersectionObserver) ─────
function setupContentReveal() {
    if (!window.IntersectionObserver) return;
    window._revealObs = new IntersectionObserver((entries) => {
        entries.forEach(e => {
            if (e.isIntersecting) {
                e.target.classList.add('visible');
                window._revealObs.unobserve(e.target);
            }
        });
    }, { threshold: 0.04, rootMargin: '0px 0px -16px 0px' });
}

function applyRevealAnimation(container) {
    if (!window._revealObs) return;
    const els = container.querySelectorAll(
        'p, h2, h3, h4, ul, ol, pre, .callout, table, .chapter-info, .code-wrapper'
    );
    els.forEach((el, i) => {
        el.classList.add('reveal-item');
        el.style.transitionDelay = Math.min(i * 38, 380) + 'ms';
        window._revealObs.observe(el);
    });
}

// ── Callout Box Transformation ────────────────
function transformCallouts(container) {
    container.querySelectorAll('blockquote').forEach(bq => {
        const raw = bq.textContent.trim().toLowerCase();
        let type = 'note', icon = 'fa-info-circle', label = 'Note';
        if (/^(tip|💡)/.test(raw)) {
            type = 'tip'; icon = 'fa-lightbulb'; label = 'Tip';
        } else if (/^(warning|warn|⚠️)/.test(raw)) {
            type = 'warning'; icon = 'fa-exclamation-triangle'; label = 'Warning';
        } else if (/^(rule|key|🔑)/.test(raw)) {
            type = 'rule'; icon = 'fa-key'; label = 'Key Rule';
        }
        const div = document.createElement('div');
        div.className = `callout callout-${type}`;
        div.innerHTML =
            `<span class="callout-icon"><i class="fas ${icon}"></i></span>` +
            `<div class="callout-body"><strong>${label}</strong><p>${bq.innerHTML}</p></div>`;
        bq.replaceWith(div);
    });
    // Also style the challenge/community paragraph at the end of lesson files
    container.querySelectorAll('p').forEach(p => {
        if (/^Module Challenge:/i.test(p.textContent.trim())) {
            const div = document.createElement('div');
            div.className = 'callout callout-rule';
            div.innerHTML =
                `<span class="callout-icon"><i class="fas fa-tasks"></i></span>` +
                `<div class="callout-body"><strong>Module Challenge</strong>` +
                `<p>${p.innerHTML.replace(/^Module Challenge:\s*/i, '')}</p></div>`;
            p.replaceWith(div);
        }
    });
}

// ── Copy Buttons on <pre> elements ────────────
function addCopyButtons(container) {
    container.querySelectorAll('pre').forEach(pre => {
        if (pre.closest('.code-wrapper')) return;
        const wrap = document.createElement('div');
        wrap.className = 'code-wrapper';
        pre.replaceWith(wrap);
        wrap.appendChild(pre);
        const btn = document.createElement('button');
        btn.className = 'copy-code-btn';
        btn.innerHTML = '<i class="fas fa-copy"></i> Copy';
        btn.title = 'Copy code';
        btn.addEventListener('click', () => {
            const text = (pre.querySelector('code') || pre).textContent;
            if (navigator.clipboard) {
                navigator.clipboard.writeText(text).then(() => {
                    btn.className = 'copy-code-btn copied';
                    btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
                    setTimeout(() => {
                        btn.className = 'copy-code-btn';
                        btn.innerHTML = '<i class="fas fa-copy"></i> Copy';
                    }, 2000);
                });
            }
        });
        wrap.appendChild(btn);
    });
}

// ── Banner Title Fade-swap Animation ──────────
function animateBannerTitle(newTitle) {
    const el = document.getElementById('current-module-title');
    if (!el) return;
    el.classList.add('fading');
    setTimeout(() => {
        el.textContent = newTitle;
        el.classList.remove('fading');
    }, 160);
}

// ── Tab Badge Counter ─────────────────────────
function updateTabBadges(module, theoryContent) {
    const codeCount = theoryContent.querySelectorAll('pre code').length;
    const hasLab    = Boolean(module.colabNotebook);

    // Code tab
    const codeTab = document.querySelector('.ltab[data-tab="code"]');
    if (codeTab) {
        let badge = codeTab.querySelector('.ltab-badge');
        if (codeCount > 0) {
            if (!badge) { badge = document.createElement('span'); badge.className = 'ltab-badge'; codeTab.appendChild(badge); }
            badge.textContent = codeCount;
        } else if (badge) badge.remove();
    }

    // Lab tab
    const labTab = document.querySelector('.ltab[data-tab="lab"]');
    if (labTab) {
        const span = labTab.querySelector('span');
        if (span) span.textContent = hasLab ? 'Lab' : 'Lab';
        let badge = labTab.querySelector('.ltab-badge');
        if (hasLab) {
            if (!badge) { badge = document.createElement('span'); badge.className = 'ltab-badge'; badge.innerHTML = '<i class="fas fa-check" style="font-size:0.6rem"></i>'; labTab.appendChild(badge); }
        } else if (badge) badge.remove();
    }
}

// ── Open in Colab Banner ──────────────────────
function updateColabBanner(module) {
    const labPanel = document.getElementById('tab-lab');
    if (!labPanel) return;
    const existing = labPanel.querySelector('.open-colab-banner');
    if (existing) existing.remove();
    if (!module || !module.colabNotebook) return;
    const nbPath = module.colabNotebook.replace('./', '');
    const colabUrl = `https://colab.research.google.com/github/eduardd76/Claude_code_course/blob/main/ai-networking-security-academy/${nbPath}`;
    const banner = document.createElement('div');
    banner.className = 'open-colab-banner';
    banner.innerHTML =
        `<span><i class="fab fa-python" style="color:#f59e0b;margin-right:6px;"></i>` +
        `Run this notebook interactively in Google Colab</span>` +
        `<a href="${colabUrl}" target="_blank" rel="noopener" class="btn-open-colab">` +
        `<i class="fas fa-external-link-alt"></i> Open in Colab</a>`;
    labPanel.insertBefore(banner, labPanel.firstChild);
}

// ── Celebration Confetti ──────────────────────
function triggerCelebration() {
    let cv = document.getElementById('celebration-canvas');
    if (!cv) { cv = document.createElement('canvas'); cv.id = 'celebration-canvas'; document.body.appendChild(cv); }
    cv.width  = window.innerWidth;
    cv.height = window.innerHeight;
    const ctx = cv.getContext('2d');
    const palette = ['#6366f1','#00d4aa','#f59e0b','#ec4899','#3b82f6','#10b981','#818cf8'];
    const ptcls = Array.from({ length: 90 }, () => ({
        x:   cv.width  * (0.3 + Math.random() * 0.4),
        y:   cv.height * (0.4 + Math.random() * 0.2),
        vx:  (Math.random() - 0.5) * 16,
        vy:  (Math.random() - 0.9) * 14,
        r:   Math.random() * 5 + 3,
        c:   palette[Math.floor(Math.random() * palette.length)],
        a:   1,
        rot: Math.random() * Math.PI * 2,
        rv:  (Math.random() - 0.5) * 0.18
    }));
    function tick() {
        ctx.clearRect(0, 0, cv.width, cv.height);
        let alive = false;
        ptcls.forEach(p => {
            p.x += p.vx; p.y += p.vy; p.vy += 0.38;
            p.a -= 0.013; p.rot += p.rv;
            if (p.a > 0) {
                alive = true;
                ctx.save();
                ctx.globalAlpha = p.a;
                ctx.fillStyle   = p.c;
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rot);
                ctx.fillRect(-p.r, -p.r * 0.5, p.r * 2, p.r);
                ctx.restore();
            }
        });
        if (alive) requestAnimationFrame(tick);
        else ctx.clearRect(0, 0, cv.width, cv.height);
    }
    tick();
}

console.log('✅ AI NetSec Academy initialized successfully!');
