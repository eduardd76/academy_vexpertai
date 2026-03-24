/* ============================================
   Claude Code Academy - Main Application
   Interactive Learning Platform
   ============================================ */

// ============================================
// Global State
// ============================================
const AppState = {
    currentModule: null,
    currentTab: 'editor',
    theme: localStorage.getItem('theme') || 'dark',
    sidebarCollapsed: false,
    completedModules: JSON.parse(localStorage.getItem('completedModules') || '[]'),
    bookmarks: JSON.parse(localStorage.getItem('bookmarks') || '[]'),
    progress: 0
};

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
});

function initializeApp() {
    console.log('🎓 Claude Code Academy - Initializing...');

    // Check if first visit
    const isFirstVisit = !localStorage.getItem('visitedBefore');
    if (isFirstVisit) {
        setTimeout(() => showWelcomeModal(), 500);
        localStorage.setItem('visitedBefore', 'true');
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
// Module Management
// ============================================
function loadModules() {
    const moduleList = document.getElementById('module-list');

    if (!window.MODULES || !window.MODULES.groups) {
        // Load sample structure if modules.js not loaded yet
        loadSampleModules();
        return;
    }

    moduleList.innerHTML = '';

    window.MODULES.groups.forEach(group => {
        const groupElement = createModuleGroup(group);
        moduleList.appendChild(groupElement);
    });

    // Load first module by default
    if (window.MODULES.groups[0]?.modules[0]) {
        loadModule(window.MODULES.groups[0].modules[0].id);
    }
}

function createModuleGroup(group) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'module-group';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'module-group-title';
    titleDiv.innerHTML = `
        <span>${group.title}</span>
        <span>${group.modules.length} modules</span>
    `;

    groupDiv.appendChild(titleDiv);

    group.modules.forEach(module => {
        const moduleItem = createModuleItem(module);
        groupDiv.appendChild(moduleItem);
    });

    return groupDiv;
}

function createModuleItem(module) {
    const item = document.createElement('div');
    item.className = 'module-item';
    item.dataset.moduleId = module.id;

    const isCompleted = AppState.completedModules.includes(module.id);
    if (isCompleted) {
        item.classList.add('completed');
    }

    const icon = isCompleted ? 'fa-check-circle' : 'fa-circle';

    item.innerHTML = `
        <div class="module-icon"><i class="fas ${icon}"></i></div>
        <div class="module-title">${module.title}</div>
        ${module.badge ? `<span class="module-badge">${module.badge}</span>` : ''}
    `;

    item.addEventListener('click', () => loadModule(module.id));

    return item;
}

function loadModule(moduleId) {
    showLoading();

    // Find module in data
    const module = findModuleById(moduleId);

    if (!module) {
        console.error('Module not found:', moduleId);
        hideLoading();
        return;
    }

    AppState.currentModule = module;

    // Update UI
    updateModuleUI(module);

    // Update active state
    document.querySelectorAll('.module-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.moduleId === moduleId) {
            item.classList.add('active');
        }
    });

    setTimeout(hideLoading, 300);
}

function findModuleById(moduleId) {
    if (!window.MODULES || !window.MODULES.groups) return null;

    for (const group of window.MODULES.groups) {
        const module = group.modules.find(m => m.id === moduleId);
        if (module) return module;
    }
    return null;
}

function updateModuleUI(module) {
    // Update title
    document.getElementById('current-module-title').textContent = module.title;

    // Update theory content
    const theoryContent = document.getElementById('theory-content');
    theoryContent.innerHTML = marked.parse(module.theory || '# Loading...');

    // Apply syntax highlighting to code blocks
    theoryContent.querySelectorAll('pre code').forEach(block => {
        hljs.highlightElement(block);
    });

    // Update code editor
    if (module.code) {
        document.getElementById('code-editor').value = module.code;
    }

    // Update examples
    loadExamples(module.examples || []);

    // Update hints
    document.getElementById('hint-content').textContent = module.hint || 'Try the examples above or write your own code!';

    // Scroll to top
    theoryContent.scrollTop = 0;
}

function loadExamples(examples) {
    const container = document.getElementById('examples-container');

    if (!examples || examples.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">No examples available for this module.</p>';
        return;
    }

    container.innerHTML = '';

    examples.forEach((example, index) => {
        const card = document.createElement('div');
        card.className = 'example-card';
        card.innerHTML = `
            <h4>${example.title}</h4>
            <p>${example.description}</p>
            <div class="example-code">${escapeHtml(example.code)}</div>
            <button class="btn-load-example" data-code="${escapeHtml(example.code)}">
                <i class="fas fa-download"></i> Load in Editor
            </button>
        `;

        card.querySelector('.btn-load-example').addEventListener('click', (e) => {
            const code = e.target.dataset.code || e.target.closest('.btn-load-example').dataset.code;
            document.getElementById('code-editor').value = unescapeHtml(code);
            switchTab('editor');
            showToast('Example loaded', 'Code loaded into editor', 'success');
        });

        container.appendChild(card);
    });
}

// ============================================
// Code Playground
// ============================================
function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.code-tab').forEach(tab => {
        tab.classList.remove('active');
        if (tab.dataset.tab === tabName) {
            tab.classList.add('active');
        }
    });

    // Update tab content
    document.querySelectorAll('.code-tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`${tabName}-tab`).classList.add('active');

    AppState.currentTab = tabName;
}

function runCode() {
    const code = document.getElementById('code-editor').value;
    const language = document.getElementById('language-select').value;

    if (!code.trim()) {
        showToast('No code to run', 'Please enter some code first', 'warning');
        return;
    }

    switchTab('output');

    const output = document.getElementById('output-content');
    output.textContent = '⚙️ Executing code...\n\n';

    // Simulate execution
    setTimeout(() => {
        output.textContent += simulateExecution(code, language);
    }, 500);

    showToast('Code executed', `${language} code executed successfully`, 'success');
}

function simulateExecution(code, language) {
    // This is a simulation - in real implementation, you'd need backend or WebAssembly
    const lines = code.split('\n').filter(line => line.trim());
    let output = '';

    output += `Language: ${language}\n`;
    output += `Lines: ${lines.length}\n`;
    output += `Characters: ${code.length}\n\n`;
    output += '─────────────────────────────────\n\n';

    // Simple pattern matching for common commands
    if (language === 'bash') {
        if (code.includes('echo')) {
            const matches = code.match(/echo\s+"([^"]*)"/g);
            if (matches) {
                matches.forEach(match => {
                    const text = match.match(/"([^"]*)"/)[1];
                    output += text + '\n';
                });
            }
        }
        if (code.includes('claude --version')) {
            output += 'claude version 0.5.3\n';
        }
        if (code.includes('ls')) {
            output += 'example-file.txt\nproject-folder/\nREADME.md\n';
        }
    } else if (language === 'python') {
        if (code.includes('print')) {
            const matches = code.match(/print\(["']([^"']*)["']\)/g);
            if (matches) {
                matches.forEach(match => {
                    const text = match.match(/["']([^"']*)["']/)[1];
                    output += text + '\n';
                });
            }
        }
    } else if (language === 'javascript' || language === 'typescript') {
        if (code.includes('console.log')) {
            const matches = code.match(/console\.log\(["'`]([^"'`]*)["'`]\)/g);
            if (matches) {
                matches.forEach(match => {
                    const text = match.match(/["'`]([^"'`]*)["'`]/)[1];
                    output += text + '\n';
                });
            }
        }
    }

    if (output.split('\n').length === 5) {
        output += '✅ Code executed successfully!\n';
        output += '\nNote: This is a simulated environment.\n';
        output += 'For real execution, use Claude Code CLI in your terminal.\n';
    }

    return output;
}

function resetCode() {
    if (AppState.currentModule && AppState.currentModule.code) {
        document.getElementById('code-editor').value = AppState.currentModule.code;
        showToast('Code reset', 'Restored original example code', 'info');
    } else {
        document.getElementById('code-editor').value = '# Write your code here\n\n';
        showToast('Code cleared', 'Editor cleared', 'info');
    }
}

function copyCode() {
    const code = document.getElementById('code-editor').value;
    navigator.clipboard.writeText(code).then(() => {
        showToast('Copied!', 'Code copied to clipboard', 'success');
    }).catch(err => {
        showToast('Copy failed', 'Could not copy to clipboard', 'error');
    });
}

function downloadCode() {
    const code = document.getElementById('code-editor').value;
    const language = document.getElementById('language-select').value;
    const extension = { bash: 'sh', python: 'py', javascript: 'js', typescript: 'ts', markdown: 'md' }[language];

    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `code-example.${extension}`;
    a.click();
    URL.revokeObjectURL(url);

    showToast('Downloaded', `Code saved as code-example.${extension}`, 'success');
}

function clearOutput() {
    document.getElementById('output-content').textContent = 'Ready to execute code...';
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

        // Update UI
        const moduleItem = document.querySelector(`[data-module-id="${moduleId}"]`);
        if (moduleItem) {
            moduleItem.classList.add('completed');
            moduleItem.querySelector('.module-icon i').className = 'fas fa-check-circle';
        }

        calculateProgress();
        showToast('Module completed! 🎉', AppState.currentModule.title, 'success');

        // Auto-advance to next module
        setTimeout(() => navigateModule('next'), 1000);
    } else {
        showToast('Already completed', 'This module is already marked as complete', 'info');
    }
}

function calculateProgress() {
    if (!window.MODULES || !window.MODULES.groups) {
        AppState.progress = 0;
        updateProgressUI();
        return;
    }

    let totalModules = 0;
    window.MODULES.groups.forEach(group => {
        totalModules += group.modules.length;
    });

    const completedCount = AppState.completedModules.length;
    AppState.progress = totalModules > 0 ? Math.round((completedCount / totalModules) * 100) : 0;

    updateProgressUI();
}

function updateProgressUI() {
    document.querySelector('.progress-percent').textContent = `${AppState.progress}%`;
    document.querySelector('.progress-fill').style.width = `${AppState.progress}%`;
}

// ============================================
// Navigation
// ============================================
function navigateModule(direction) {
    if (!window.MODULES || !AppState.currentModule) return;

    const allModules = [];
    window.MODULES.groups.forEach(group => {
        allModules.push(...group.modules);
    });

    const currentIndex = allModules.findIndex(m => m.id === AppState.currentModule.id);

    if (direction === 'next' && currentIndex < allModules.length - 1) {
        loadModule(allModules[currentIndex + 1].id);
    } else if (direction === 'prev' && currentIndex > 0) {
        loadModule(allModules[currentIndex - 1].id);
    } else {
        const msg = direction === 'next' ? 'This is the last module' : 'This is the first module';
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
        showToast('Bookmarked', 'Module added to bookmarks', 'success');
    } else {
        AppState.bookmarks.splice(index, 1);
        document.querySelector('#bookmark-btn i').className = 'far fa-bookmark';
        showToast('Removed', 'Bookmark removed', 'info');
    }

    localStorage.setItem('bookmarks', JSON.stringify(AppState.bookmarks));
}

// ============================================
// Search
// ============================================
function searchModules(query) {
    const items = document.querySelectorAll('.module-item');

    items.forEach(item => {
        const title = item.querySelector('.module-title').textContent.toLowerCase();
        if (title.includes(query.toLowerCase())) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

// ============================================
// Split Screen Resizer
// ============================================
function setupResizer() {
    const resizer = document.getElementById('resizer');
    const leftPanel = document.querySelector('.panel-left');
    const rightPanel = document.querySelector('.panel-right');

    let isResizing = false;

    resizer.addEventListener('mousedown', (e) => {
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
            const leftPercent = (leftWidth / totalWidth) * 100;
            const rightPercent = 100 - leftPercent;

            leftPanel.style.flex = `0 0 ${leftPercent}%`;
            rightPanel.style.flex = `0 0 ${rightPercent}%`;
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
    const modal = document.getElementById('welcome-modal');
    modal.classList.add('active');
}

function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.remove('active');
}

function loadWelcomeModal() {
    const modal = document.getElementById('welcome-modal');

    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => {
            modal.classList.remove('active');
        });
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
        }
    });

    document.getElementById('start-learning')?.addEventListener('click', () => {
        modal.classList.remove('active');
        if (window.MODULES?.groups[0]?.modules[0]) {
            loadModule(window.MODULES.groups[0].modules[0].id);
        }
    });

    document.getElementById('take-tour')?.addEventListener('click', () => {
        modal.classList.remove('active');
        showToast('Tour feature', 'Interactive tour coming soon!', 'info');
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

    const icons = {
        success: 'fa-check-circle',
        warning: 'fa-exclamation-triangle',
        error: 'fa-times-circle',
        info: 'fa-info-circle'
    };

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
        document.documentElement.requestFullscreen();
        document.querySelector('#fullscreen-toggle i').className = 'fas fa-compress';
    } else {
        document.exitFullscreen();
        document.querySelector('#fullscreen-toggle i').className = 'fas fa-expand';
    }
}

function toggleSidebar() {
    AppState.sidebarCollapsed = !AppState.sidebarCollapsed;
    document.getElementById('sidebar').classList.toggle('collapsed');
}

function printContent() {
    window.print();
}

function shareModule() {
    if (!AppState.currentModule) return;

    const url = `${window.location.origin}${window.location.pathname}?module=${AppState.currentModule.id}`;

    if (navigator.share) {
        navigator.share({
            title: `Claude Code Academy - ${AppState.currentModule.title}`,
            text: 'Check out this module!',
            url: url
        }).catch(() => {});
    } else {
        navigator.clipboard.writeText(url);
        showToast('Link copied', 'Module link copied to clipboard', 'success');
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function unescapeHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent;
}

// ============================================
// Event Listeners
// ============================================
function setupEventListeners() {
    // Theme toggle
    document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);

    // Fullscreen toggle
    document.getElementById('fullscreen-toggle')?.addEventListener('click', toggleFullscreen);

    // Sidebar toggle
    document.getElementById('sidebar-toggle')?.addEventListener('click', toggleSidebar);

    // Search
    document.getElementById('module-search')?.addEventListener('input', (e) => {
        searchModules(e.target.value);
    });

    // Code tabs
    document.querySelectorAll('.code-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Code actions
    document.getElementById('run-code')?.addEventListener('click', runCode);
    document.getElementById('reset-code')?.addEventListener('click', resetCode);
    document.getElementById('copy-code')?.addEventListener('click', copyCode);
    document.getElementById('download-code')?.addEventListener('click', downloadCode);
    document.getElementById('clear-output')?.addEventListener('click', clearOutput);

    // Module navigation
    document.getElementById('prev-module')?.addEventListener('click', () => navigateModule('prev'));
    document.getElementById('next-module')?.addEventListener('click', () => navigateModule('next'));
    document.getElementById('complete-module')?.addEventListener('click', completeModule);

    // Panel actions
    document.getElementById('bookmark-btn')?.addEventListener('click', toggleBookmark);
    document.getElementById('print-btn')?.addEventListener('click', printContent);
    document.getElementById('share-btn')?.addEventListener('click', shareModule);

    // FAB buttons
    document.getElementById('help-fab')?.addEventListener('click', () => {
        showToast('Help', 'Documentation coming soon!', 'info');
    });

    document.getElementById('chat-fab')?.addEventListener('click', () => {
        showToast('AI Assistant', 'Chat feature coming soon!', 'info');
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + Enter: Run code
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            runCode();
        }
        // Ctrl/Cmd + /: Toggle sidebar
        if ((e.ctrlKey || e.metaKey) && e.key === '/') {
            e.preventDefault();
            toggleSidebar();
        }
    });
}

// ============================================
// Sample Data (Fallback)
// ============================================
function loadSampleModules() {
    // This will be replaced by modules.js
    console.log('Loading sample modules...');

    const sampleContent = {
        id: 'welcome',
        title: 'Welcome to Claude Code Academy',
        theory: `# Welcome to Claude Code Academy! 🎓

## Your Complete Learning Journey

Welcome to the most comprehensive Claude Code training platform! This interactive learning experience will take you from beginner to expert.

### What You'll Learn

- **Complete CLI Mastery**: All commands, tools, and workflows
- **SDK Development**: Python and TypeScript SDKs
- **Agent Building**: Create autonomous AI agents
- **Extensions**: Skills, Plugins, and MCP servers
- **Production**: Security, testing, and deployment

### How to Use This Platform

**Left Panel (Theory)**: Read the documentation and concepts
**Right Panel (Practice)**: Write and run code examples

Use the resizer between panels to adjust the layout to your preference.

### Navigation

- Use the sidebar to browse modules
- Click "Mark Complete" when you finish a module
- Track your progress in the sidebar
- Use keyboard shortcuts (Ctrl+Enter to run code)

### Getting Started

1. Read through this welcome module
2. Try the code examples on the right
3. Progress through modules in order
4. Practice with every example
5. Complete exercises as you go

Let's begin your journey to Claude Code mastery! 🚀`,
        code: `# Welcome to Claude Code!
# Try running some basic commands

echo "Hello from Claude Code Academy!"
echo "Let's start learning..."

# Check Claude Code version
claude --version

# Get help
claude --help`,
        examples: [
            {
                title: 'First Command',
                description: 'Your first Claude Code command',
                code: 'claude --version'
            },
            {
                title: 'Start a Session',
                description: 'Start an interactive session',
                code: 'cd your-project\nclaude'
            }
        ],
        hint: 'Click "Run Code" or press Ctrl+Enter to execute the code!'
    };

    updateModuleUI(sampleContent);
    AppState.currentModule = sampleContent;
}

console.log('✅ App initialized successfully!');
