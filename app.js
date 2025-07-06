document.addEventListener('alpine:init', () => {
    Alpine.data('translator', () => ({
        // --- CONFIGURATION ---
        baseUrl: '',
        debounceTimeout: 500,
        connectionInterval: 15000,
        toastDuration: 3000,

        // --- STATE ---
        languages: [],
        sourceLang: 'auto',
        targetLang: 'en',
        detectedLang: '',
        sourceText: '',
        translatedText: '',
        charLimit: -1,
        isConnected: false,
        translationTimeout: null,

        automaticTranslation: true,

        // --- UI STATE ---
        ui: {
            isLoading: true,
            isTranslating: false,
            copied: false,
            sourceCopied: false,
            error: '',
            sourceMenuOpen: false,
            targetMenuOpen: false,
            translateMenuOpen: false,
            showDefinition: false,
            selectedWord: '',
            wordDefinition: '',
            definitionLoading: false,
            sourceSearch: '',
            targetSearch: '',
            wordPreview: {
                visible: false,
                word: '',
                top: 0,
                left: 0,
                index: -1
            }
        },

        // --- TOASTS ---
        toasts: [],
        nextToastId: 0,

        // --- INITIALIZATION ---
        init() {
            this.updateHeaderHeight();
            this.loadInitialData();
            this.setupWatchers();
            this.startConnectionMonitor();
        },

        updateHeaderHeight() {
            const header = document.querySelector(".header");
            if (header) {
                const headerHeight = header.offsetHeight;
                document.documentElement.style.setProperty('--header-height', `${headerHeight}px`);
            }
        },

        showWordPreview(event, word, index) {
            const rect = event.target.getBoundingClientRect();
            this.ui.wordPreview = {
                visible: true,
                word: word,
                top: rect.top - 40,
                left: rect.left,
                index: index
            };
        },

        hideWordPreview(index) {
            if (this.ui.wordPreview.index === index) {
                this.ui.wordPreview.visible = false;
            }
        },

        selectWord(word) {
            this.ui.selectedWord = word;
            this.ui.showDefinition = true;
            this.fetchDefinition();
        },

        async fetchDefinition() {
            this.ui.definitionLoading = true;
            this.ui.wordDefinition = '';
            try {
                const response = await fetch(`/search?word=${this.ui.selectedWord}`);
                const data = await response.json();
                if (data.length > 0) {
                    this.ui.wordDefinition = this.formatSenses(data[0]);
                } else {
                    this.ui.wordDefinition = null;
                }
            } catch (error) {
                this.ui.wordDefinition = null;
            } finally {
                this.ui.definitionLoading = false;
            }
        },

        formatSenses(data) {
            if (!data || !data.senses) return '<div class="no-definition-found">No definition found.</div>';

            let html = '<div class="definition-sections">';

            data.senses.forEach(sense => {
                html += '<section class="definition-section">';
                
                if (sense.pos) {
                    html += `<h4 class="definition-section-header">${sense.pos}</h4>`;
                }

                if (sense.glosses) {
                    html += '<ol class="definition-list">';
                    sense.glosses.forEach(gloss => {
                        html += `<li class="definition-list-item">${gloss}</li>`;
                    });
                    html += '</ol>';
                }

                if (sense.examples && sense.examples.length > 0) {
                    html += '<div class="examples-container">';
                    html += '<h5 class="examples-header">Usage Examples:</h5>';
                    html += '<ul class="example-list">';
                    sense.examples.forEach(example => {
                        html += `<li class="example-list-item">'${example.text}'</li>`;
                        if (example.translation) {
                            html += `<li class="example-translation">${example.translation}</li>`;
                        }
                    });
                    html += '</ul>';
                    html += '</div>';
                }
                html += '</section>';
            });

            html += '</div>';
            
            html += `
                <div class="context-meaning-container">
                    <button class="btn-secondary btn-context-meaning" @click="// Future AI function">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1.5c3.59 0 6.5 2.91 6.5 6.5s-2.91 6.5-6.5 6.5A6.51 6.51 0 011.5 8c0-3.59 2.91-6.5 6.5-6.5zM8 0a8 8 0 100 16A8 8 0 008 0zM6 6a1 1 0 11-2 0 1 1 0 012 0zm4 0a1 1 0 11-2 0 1 1 0 012 0zm-3 5.5a.5.5 0 01.5-.5h2a.5.5 0 010 1h-2a.5.5 0 01-.5-.5z"/></svg>
                        <span>Explain meaning in this context</span>
                    </button>
                </div>
            `;

            return html;
        },

        setupWatchers() {
            const savedSourceLang = localStorage.getItem('sourceLang');
            if (savedSourceLang) this.sourceLang = JSON.parse(savedSourceLang);

            const savedTargetLang = localStorage.getItem('targetLang');
            if (savedTargetLang) this.targetLang = JSON.parse(savedTargetLang);

            const savedAutoTranslate = localStorage.getItem('automaticTranslation');
            if (savedAutoTranslate) this.automaticTranslation = JSON.parse(savedAutoTranslate);

            this.$watch('sourceLang', val => localStorage.setItem('sourceLang', JSON.stringify(val)));
            this.$watch('targetLang', val => localStorage.setItem('targetLang', JSON.stringify(val)));
            this.$watch('automaticTranslation', val => {
                localStorage.setItem('automaticTranslation', JSON.stringify(val));
                this.addToast(`Automatic translation ${val ? 'enabled' : 'disabled'}.`, 'info');
            });
            this.$watch('ui.sourceMenuOpen', isOpen => this.handleMenuToggle(isOpen, 'source'));
            this.$watch('ui.targetMenuOpen', isOpen => this.handleMenuToggle(isOpen, 'target'));
        },

        startConnectionMonitor() {
            setInterval(() => this.checkConnection(), this.connectionInterval);
        },

        async loadInitialData() {
            this.ui.isLoading = true;
            try {
                const [languages, settings] = await Promise.all([
                    this.apiGetLanguages(),
                    this.apiGetSettings()
                ]);
                
                this.languages = languages;
                this.isConnected = true;
                
                if (this.languages.length > 0 && !this.languages.find(l => l.code === this.targetLang)) {
                    this.targetLang = this.languages[0].code;
                }
                
                this.charLimit = settings.charLimit || -1;
            } catch (err) {
                this.ui.error = 'Failed to initialize application. Please check the connection to the server.';
                this.isConnected = false;
            } finally {
                this.ui.isLoading = false;
            }
        },

        // --- API METHODS ---
        async apiFetch(endpoint, options = {}) {
            const url = `${this.baseUrl}${endpoint}`;
            try {
                const response = await fetch(url, options);
                if (!response.ok) {
                    let errorMsg = `HTTP error! status: ${response.status}`;
                    try {
                        const errorData = await response.json();
                        errorMsg = errorData.error || errorMsg;
                    } catch (e) { /* Ignore */ }
                    throw new Error(errorMsg);
                }
                return response.json();
            } catch (err) {
                console.error(`API Error (${endpoint}):`, err);
                if (err instanceof TypeError && err.message === 'Failed to fetch') {
                    throw new Error('Network error. Please check your connection.');
                }
                throw err;
            }
        },
        apiGetLanguages() { return this.apiFetch('/languages'); },
        apiGetSettings() { return this.apiFetch('/frontend/settings'); },
        apiDetectLanguage(text) {
            return this.apiFetch('/detect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `q=${encodeURIComponent(text)}`
            });
        },
        apiTranslate(text, source, target) {
            const formData = new URLSearchParams();
            formData.append('q', text);
            formData.append('source', source);
            formData.append('target', target);
            formData.append('format', 'text');
            return this.apiFetch('/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: formData.toString()
            });
        },

        // --- TOAST METHODS ---
        addToast(message, type = 'info', duration = this.toastDuration) {
            const id = this.nextToastId++;
            const toast = { id, message, type, visible: true };
            this.toasts.push(toast);
            setTimeout(() => this.removeToast(id), duration);
        },
        removeToast(id) {
            const toast = this.toasts.find(t => t.id === id);
            if (toast) {
                toast.visible = false;
                setTimeout(() => {
                    this.toasts = this.toasts.filter(t => t.id !== id);
                }, 500);
            }
        },

        // --- LANGUAGE METHODS ---
        getLanguageName(code) {
            if (code === 'auto') return 'Auto-detect';
            const lang = this.languages.find(l => l.code === code);
            return lang ? lang.name : code;
        },
        filterLanguages(languages, searchTerm) {
            if (!searchTerm) return languages;
            const term = searchTerm.toLowerCase();
            return languages.filter(lang => lang.name.toLowerCase().includes(term));
        },
        getTargetLanguages(sourceLang) {
            if (sourceLang === 'auto') return this.languages;
            const source = this.languages.find(l => l.code === sourceLang);
            if (!source) return this.languages;
            return this.languages.filter(l => source.targets.includes(l.code));
        },
        isValidTarget(sourceLang, targetLang) {
            const source = this.languages.find(l => l.code === sourceLang);
            return source && source.targets.includes(targetLang);
        },

        // --- COMPUTED PROPERTIES ---
        get filteredSourceLanguages() {
            return this.filterLanguages(this.languages, this.ui.sourceSearch);
        },
        get targetLanguages() {
            return this.getTargetLanguages(this.sourceLang);
        },
        get filteredTargetLanguages() {
            return this.filterLanguages(this.targetLanguages, this.ui.targetSearch);
        },

        // --- UI ACTIONS ---
        selectSourceLang(code) {
            if (code === this.targetLang) this.swapLanguages();
            else this.sourceLang = code;
            this.ui.sourceMenuOpen = false;
            if (this.sourceText) this.translate();
        },
        selectTargetLang(code) {
            if (code === this.sourceLang) this.swapLanguages();
            else this.targetLang = code;
            this.ui.targetMenuOpen = false;
            if (this.sourceText) this.translate();
        },
        handleMenuToggle(isOpen, type) {
            if (isOpen) {
                this.$nextTick(() => this.$refs[`${type}SearchInput`]?.focus());
            } else {
                this.ui[`${type}Search`] = '';
            }
        },
        swapLanguages() {
            if (this.sourceLang === 'auto') return;
            if (!this.isValidTarget(this.targetLang, this.sourceLang)) {
                this.ui.error = `Cannot swap: ${this.getLanguageName(this.targetLang)} does not support translating to ${this.getLanguageName(this.sourceLang)}`;
                return;
            }
            [this.sourceLang, this.targetLang] = [this.targetLang, this.sourceLang];
            [this.sourceText, this.translatedText] = [this.translatedText, this.sourceText];
        },
        async pasteFromClipboard() {
            try {
                const text = await navigator.clipboard.readText();
                this.sourceText = text;
                this.handleInput();
            } catch (err) {
                this.ui.error = 'Unable to access clipboard. Please grant permission in your browser.';
            }
        },
        async copyTranslation() {
            if (!this.translatedText) return;
            try {
                await navigator.clipboard.writeText(this.translatedText);
                this.ui.copied = true;
                setTimeout(() => this.ui.copied = false, 2000);
            } catch (err) {
                this.addToast('Failed to copy to clipboard.', 'error');
            }
        },

        async copySourceText() {
            if (!this.sourceText) return;
            try {
                await navigator.clipboard.writeText(this.sourceText);
                this.ui.sourceCopied = true;
                setTimeout(() => this.ui.sourceCopied = false, 2000);
            } catch (err) {
                this.addToast('Failed to copy to clipboard.', 'error');
            }
        },

        // --- TRANSLATION LOGIC ---
        handleInput() {
            this.ui.error = '';
            this.detectedLang = '';
            if (this.translationTimeout) clearTimeout(this.translationTimeout);

            if (this.sourceText.trim()) {
                if (this.automaticTranslation) {
                    this.ui.isTranslating = true;
                    this.translationTimeout = setTimeout(() => this.translate(), this.debounceTimeout);
                }
            } else {
                this.translatedText = '';
                this.ui.isTranslating = false;
            }
        },
        _validateTargetLanguage(sourceLang) {
            const sourceLangObj = this.languages.find(l => l.code === sourceLang);
            if (sourceLangObj && !sourceLangObj.targets.includes(this.targetLang)) {
                const newTarget = sourceLangObj.targets.includes('en') ? 'en' : (sourceLangObj.targets[0] || 'en');
                this.targetLang = newTarget;
            }
        },
        async translate() {
            if (!this.sourceText.trim()) return;
            
            this.ui.isTranslating = true;
            this.ui.error = '';
            this.detectedLang = '';
            
            try {
                let source = this.sourceLang;
                if (source === 'auto') {
                    const detections = await this.apiDetectLanguage(this.sourceText);
                    if (detections.length > 0 && detections[0].confidence > 0.5) {
                        source = detections[0].language;
                        this.detectedLang = source;
                        this._validateTargetLanguage(source);
                    } else {
                        source = 'en'; // Fallback
                    }
                }

                const result = await this.apiTranslate(this.sourceText, source, this.targetLang);
                this.translatedText = result.translatedText;
            } catch (err) {
                this.ui.error = err.message || 'An unknown translation error occurred.';
                this.translatedText = '';
            }
            finally {
                this.ui.isTranslating = false;
            }
        },

        // --- HEALTH CHECK ---
        async checkConnection() {
            try {
                await this.apiGetLanguages();
                this.isConnected = true;
            } catch (err) {
                this.isConnected = false;
            }
        }
    }));
});
