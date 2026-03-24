/* ============================================
   Notebook Loader - Fetch and Display Colab Notebooks
   ============================================ */

class NotebookLoader {
    constructor() {
        this.currentNotebook = null;
        this.cache = new Map();
    }

    isLocalNotebookPath(notebookUrl) {
        return notebookUrl?.startsWith('./') || notebookUrl?.startsWith('/');
    }

    isColabNotebookUrl(notebookUrl) {
        return notebookUrl?.includes('colab.research.google.com');
    }

    /**
     * Convert Colab URL to raw GitHub URL
     */
    colabToRawUrl(colabUrl) {
        // https://colab.research.google.com/github/USER/REPO/blob/BRANCH/PATH
        // to
        // https://raw.githubusercontent.com/USER/REPO/BRANCH/PATH

        const match = colabUrl.match(/colab\.research\.google\.com\/github\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)/);
        if (match) {
            const [, user, repo, branch, path] = match;
            return `https://raw.githubusercontent.com/${user}/${repo}/${branch}/${path}`;
        }

        return null;
    }

    /**
     * Fetch notebook from GitHub or local path
     */
    async fetchNotebook(colabUrl, bypassCache = false) {
        // Check cache first (unless bypassing)
        if (!bypassCache && this.cache.has(colabUrl)) {
            console.log('📦 Loading notebook from cache');
            return this.cache.get(colabUrl);
        }

        // Check if it's a local path (starts with ./ or /)
        let fetchUrl;
        if (colabUrl.startsWith('./') || colabUrl.startsWith('/')) {
            fetchUrl = colabUrl;
            console.log('📁 Loading notebook from local path:', fetchUrl);
        } else {
            const rawUrl = this.colabToRawUrl(colabUrl);
            if (!rawUrl) {
                throw new Error('Invalid Colab URL format');
            }
            fetchUrl = rawUrl;
            console.log('🌐 Fetching notebook from GitHub:', fetchUrl);
        }

        try {
            // Add cache-busting parameter
            const cacheBuster = bypassCache ? `?t=${Date.now()}` : '';
            const response = await fetch(fetchUrl + cacheBuster);

            if (!response.ok) {
                throw new Error(`Failed to fetch notebook: ${response.statusText}`);
            }

            const notebook = await response.json();
            this.cache.set(colabUrl, notebook);

            console.log(`✅ Loaded notebook with ${notebook.cells?.length || 0} cells`);
            return notebook;
        } catch (error) {
            console.error('Error fetching notebook:', error);
            throw error;
        }
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
        console.log('🗑️ Notebook cache cleared');
    }

    /**
     * Render notebook in the code panel
     */
    renderNotebook(notebook, containerId = 'notebook-container') {
        this.currentNotebook = notebook;
        const notebookUrl = AppState?.currentModule?.colabNotebook || '';
        const opensColab = this.isColabNotebookUrl(notebookUrl);
        const openButtonText = opensColab ? 'Run in Colab' : 'Open Notebook';
        const openButtonTitle = opensColab ? 'Open in Google Colab' : 'Open notebook source';

        const container = document.getElementById(containerId);
        if (!container) {
            console.error('Container not found:', containerId);
            return;
        }

        container.innerHTML = '';

        // Add notebook header
        const header = document.createElement('div');
        header.className = 'notebook-header';
        header.innerHTML = `
            <div class="notebook-title">
                <i class="fab fa-python"></i>
                <span>Interactive Notebook</span>
                <span class="notebook-cell-count">${notebook.cells?.length || 0} cells</span>
            </div>
            <div class="notebook-actions">
                <button class="btn btn-secondary btn-icon-only" onclick="notebookLoader.refreshNotebook()" title="Refresh from GitHub">
                    <i class="fas fa-sync-alt"></i>
                </button>
                <button class="btn btn-primary" onclick="notebookLoader.openInColab()" title="${openButtonTitle}">
                    <i class="fab fa-google"></i>
                    ${openButtonText}
                </button>
                <button class="btn btn-secondary" onclick="notebookLoader.copyAllCode()" title="Copy all code cells">
                    <i class="fas fa-copy"></i>
                    Copy All Code
                </button>
            </div>
        `;
        container.appendChild(header);

        // Create cells container
        const cellsContainer = document.createElement('div');
        cellsContainer.className = 'notebook-cells';

        const cells = notebook.cells || [];
        cells.forEach((cell, index) => {
            const cellElement = this.createCellElement(cell, index);
            if (cellElement) {
                cellsContainer.appendChild(cellElement);
            }
        });

        container.appendChild(cellsContainer);

        // Apply syntax highlighting
        setTimeout(() => {
            container.querySelectorAll('pre code').forEach(block => {
                if (typeof hljs !== 'undefined') {
                    hljs.highlightElement(block);
                }
            });
        }, 100);
    }

    /**
     * Create a cell element
     */
    createCellElement(cell, index) {
        const cellDiv = document.createElement('div');
        cellDiv.className = `notebook-cell notebook-cell-${cell.cell_type}`;
        cellDiv.dataset.cellIndex = index;

        if (cell.cell_type === 'markdown') {
            // Render markdown cell
            cellDiv.innerHTML = `
                <div class="cell-content markdown-content">
                    ${this.renderMarkdown(cell.source)}
                </div>
            `;
        } else if (cell.cell_type === 'code') {
            // Render code cell
            const source = Array.isArray(cell.source) ? cell.source.join('') : cell.source;
            const outputs = cell.outputs || [];

            cellDiv.innerHTML = `
                <div class="cell-header">
                    <span class="cell-label">
                        <i class="fas fa-terminal"></i>
                        In [${index + 1}]
                    </span>
                    <div class="cell-actions">
                        <button class="btn-icon btn-sm" onclick="notebookLoader.copyCellCode(${index})" title="Copy code">
                            <i class="fas fa-copy"></i>
                        </button>
                        <button class="btn-icon btn-sm" onclick="notebookLoader.runCellInColab(${index})" title="Run in Colab">
                            <i class="fab fa-google"></i>
                        </button>
                    </div>
                </div>
                <div class="cell-content code-content">
                    <pre><code class="language-python">${this.escapeHtml(source)}</code></pre>
                </div>
                ${outputs.length > 0 ? this.renderOutputs(outputs, index) : ''}
            `;
        }

        return cellDiv;
    }

    /**
     * Render markdown content
     */
    renderMarkdown(source) {
        const text = Array.isArray(source) ? source.join('') : source;
        if (typeof marked !== 'undefined') {
            return marked.parse(text);
        }
        return `<pre>${this.escapeHtml(text)}</pre>`;
    }

    /**
     * Render cell outputs
     */
    renderOutputs(outputs, cellIndex) {
        if (!outputs || outputs.length === 0) return '';

        let outputHtml = `
            <div class="cell-output">
                <div class="output-label">
                    <i class="fas fa-arrow-right"></i>
                    Out [${cellIndex + 1}]
                </div>
                <div class="output-content">
        `;

        outputs.forEach(output => {
            if (output.output_type === 'stream') {
                const text = Array.isArray(output.text) ? output.text.join('') : output.text;
                outputHtml += `<pre class="output-stream">${this.escapeHtml(text)}</pre>`;
            } else if (output.output_type === 'execute_result' || output.output_type === 'display_data') {
                if (output.data) {
                    if (output.data['text/plain']) {
                        const text = Array.isArray(output.data['text/plain'])
                            ? output.data['text/plain'].join('')
                            : output.data['text/plain'];
                        outputHtml += `<pre class="output-result">${this.escapeHtml(text)}</pre>`;
                    }
                    if (output.data['text/html']) {
                        const html = Array.isArray(output.data['text/html'])
                            ? output.data['text/html'].join('')
                            : output.data['text/html'];
                        outputHtml += `<div class="output-html">${html}</div>`;
                    }
                    if (output.data['image/png']) {
                        outputHtml += `<img src="data:image/png;base64,${output.data['image/png']}" class="output-image" alt="Output image">`;
                    }
                }
            } else if (output.output_type === 'error') {
                const traceback = output.traceback ? output.traceback.join('\n') : '';
                outputHtml += `<pre class="output-error">${this.escapeHtml(traceback)}</pre>`;
            }
        });

        outputHtml += `
                </div>
            </div>
        `;

        return outputHtml;
    }

    /**
     * Escape HTML
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Open notebook in Colab
     */
    openInColab() {
        if (!AppState.currentModule || !AppState.currentModule.colabNotebook) return;
        const nb = AppState.currentModule.colabNotebook.replace('./', '');
        // Build real Colab URL from the local path
        const colabUrl = 'https://colab.research.google.com/github/eduardd76/Claude_code_course/blob/main/ai-networking-security-academy/' + nb;
        window.open(colabUrl, '_blank');
    }

    /**
     * Copy cell code
     */
    copyCellCode(cellIndex) {
        if (!this.currentNotebook) return;

        const cell = this.currentNotebook.cells[cellIndex];
        if (cell && cell.cell_type === 'code') {
            const source = Array.isArray(cell.source) ? cell.source.join('') : cell.source;
            navigator.clipboard.writeText(source)
                .then(() => {
                    showToast('Copied!', 'Code copied to clipboard', 'success');
                })
                .catch(() => {
                    showToast('Copy failed', 'Clipboard access was blocked by the browser', 'warning');
                });
        }
    }

    /**
     * Copy all code from notebook
     */
    copyAllCode() {
        if (!this.currentNotebook) return;

        const codeCells = this.currentNotebook.cells.filter(c => c.cell_type === 'code');
        const allCode = codeCells.map(cell => {
            return Array.isArray(cell.source) ? cell.source.join('') : cell.source;
        }).join('\n\n# ---\n\n');

        navigator.clipboard.writeText(allCode)
            .then(() => {
                showToast('Copied!', 'All code copied to clipboard', 'success');
            })
            .catch(() => {
                showToast('Copy failed', 'Clipboard access was blocked by the browser', 'warning');
            });
    }

    /**
     * Run cell in Colab (opens Colab)
     */
    runCellInColab(cellIndex) {
        this.openInColab();
    }

    /**
     * Load notebook for current module
     */
    async loadCurrentNotebook(bypassCache = false) {
        if (!AppState.currentModule || !AppState.currentModule.colabNotebook) {
            this.showNoNotebookMessage();
            return;
        }

        const container = document.getElementById('notebook-container');
        if (!container) return;

        try {
            // Show loading
            container.innerHTML = `
                <div class="notebook-loading">
                    <div class="loading-spinner"></div>
                    <p>Loading notebook...</p>
                    ${bypassCache ? '<p style="font-size: 0.9em; color: var(--text-secondary);">Bypassing cache...</p>' : ''}
                </div>
            `;

            const notebook = await this.fetchNotebook(AppState.currentModule.colabNotebook, bypassCache);
            this.renderNotebook(notebook);

            if (bypassCache) {
                showToast('Refreshed', 'Notebook reloaded from GitHub', 'success');
            }
        } catch (error) {
            container.innerHTML = `
                <div class="notebook-error">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h3>Failed to Load Notebook</h3>
                    <p>${error.message}</p>
                    <button class="btn btn-primary" onclick="notebookLoader.openInColab()">
                        <i class="fab fa-google"></i>
                        Open in Colab Instead
                    </button>
                    <button class="btn btn-secondary" onclick="notebookLoader.refreshNotebook()" style="margin-left: 10px;">
                        <i class="fas fa-sync-alt"></i>
                        Try Again
                    </button>
                </div>
            `;
        }
    }

    /**
     * Refresh notebook from GitHub (bypass cache)
     */
    async refreshNotebook() {
        await this.loadCurrentNotebook(true);
    }

    /**
     * Show message when no notebook available
     */
    showNoNotebookMessage() {
        const container = document.getElementById('notebook-container');
        if (!container) return;

        container.innerHTML = `
            <div class="notebook-placeholder">
                <i class="fas fa-code"></i>
                <h3>No Interactive Notebook</h3>
                <p>This chapter doesn't have an associated notebook yet.</p>
                <p>Select another chapter with a notebook badge in the sidebar.</p>
            </div>
        `;
    }
}

// Global instance
const notebookLoader = new NotebookLoader();
