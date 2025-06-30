/**
 * @file Manages the frontend logic for the translation application.
/**
 * Configuration object for the application.
 * @typedef {object} Config
 * @property {string} baseUrl - The base URL of the translation API.
 * @property {number} debounceTimeout - The delay in milliseconds for debouncing translation requests.
 * @property {number} connectionInterval - The interval in milliseconds for checking the API connection status.
 */

/** @type {Config} */
const config = {
    baseUrl: 'http://192.168.2.77:5000',
    debounceTimeout: 500,
    connectionInterval: 15000
};

/**
 * Service object for handling all API interactions.
 * @namespace apiService
 */
const apiService = {
    /**
     * A generic fetch wrapper for making API requests.
     * @param {string} endpoint - The API endpoint to call.
     * @param {RequestInit} [options={}] - The options for the fetch request.
     * @returns {Promise<any>} A promise that resolves with the JSON response.
     * @throws {Error} Throws an error if the network request fails or the API returns an error.
     */
    async fetch(endpoint, options = {}) {
        const url = `${config.baseUrl}${endpoint}`;
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                let errorMsg = `HTTP error! status: ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorMsg = errorData.error || errorMsg;
                } catch (e) {
                    // Response might not be JSON, stick with the HTTP status error.
                }
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

    /** Fetches the list of supported languages. */
    getLanguages() { return this.fetch('/languages'); },

    /** Fetches the frontend settings, like character limits. */
    getSettings() { return this.fetch('/frontend/settings'); },

    /**
     * Detects the language of a given text.
     * @param {string} text - The text to analyze.
     */
    detectLanguage(text) {
        return this.fetch('/detect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `q=${encodeURIComponent(text)}`
        });
    },

    /**
     * Translates a given text.
     * @param {string} text - The text to translate.
     * @param {string} source - The source language code.
     * @param {string} target - The target language code.
     */
    translate(text, source, target) {
        const formData = new URLSearchParams();
        formData.append('q', text);
        formData.append('source', source);
        formData.append('target', target);
        formData.append('format', 'text');
        return this.fetch('/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData.toString()
        });
    }
};

/**
 * The main Alpine.js component for the translator application.
 * @returns {object} The Alpine component object.
 */
function translator() {
    return {
        // State
        languages: [],
        sourceLang: localStorage.getItem('sourceLang') || 'auto',
        targetLang: localStorage.getItem('targetLang') || 'en',
        detectedLang: '',
        sourceText: '',
        translatedText: '',
        charLimit: -1,
        translationTimeout: null,
        isConnected: false,

        /** UI-related state. */
        ui: {
            isLoading: true,
            isTranslating: false,
            copied: false,
            error: '',
            sourceMenuOpen: false,
            targetMenuOpen: false,
            sourceSearch: '',
            targetSearch: '',
        },

        /** @type {Array<object>} A list of active toast notifications. */
        toasts: [],
        nextToastId: 0,

        /**
         * Initializes the component, loads data, and sets up watchers.
         */
        async init() {
            await this.loadInitialData();
            this.$watch('sourceLang', val => localStorage.setItem('sourceLang', val));
            this.$watch('targetLang', val => localStorage.setItem('targetLang', val));
            this.$watch('ui.sourceMenuOpen', isOpen => this.handleMenuToggle(isOpen, 'source'));
            this.$watch('ui.targetMenuOpen', isOpen => this.handleMenuToggle(isOpen, 'target'));
            setInterval(() => this.checkConnection(), config.connectionInterval);
        },

        /**
         * Loads the initial data (languages and settings) for the application.
         */
        async loadInitialData() {
            this.ui.isLoading = true;
            try {
                const [languages, settings] = await Promise.all([apiService.getLanguages(), apiService.getSettings()]);
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

        /**
         * Adds a new toast notification.
         * @param {string} message - The message to display.
         * @param {'success'|'error'} type - The type of toast.
         * @param {number} [duration=3000] - The duration in ms to show the toast.
         */
        addToast(message, type, duration = 3000) {
            const id = this.nextToastId++;
            this.toasts.push({ id, message, type, visible: true });
            setTimeout(() => {
                this.removeToast(id);
            }, duration);
        },

        /**
         * Removes a toast notification.
         * @param {number} id - The ID of the toast to remove.
         */
        removeToast(id) {
            const toast = this.toasts.find(t => t.id === id);
            if (toast) {
                toast.visible = false;
                // Allow time for fade-out transition before removing from array
                setTimeout(() => {
                    this.toasts = this.toasts.filter(t => t.id !== id);
                }, 500);
            }
        },

        /**
         * Gets the full name of a language from its code.
         * @param {string} code - The language code (e.g., 'en').
         * @returns {string} The full language name or the code if not found.
         */
        getLanguageName(code) {
            if (code === 'auto') return 'Auto-detect';
            const lang = this.languages.find(l => l.code === code);
            return lang ? lang.name : code;
        },

        /**
         * Sets the source language and triggers a translation.
         * @param {string} code - The language code to set.
         */
        selectSourceLang(code) {
            if (code === this.targetLang) {
                this.swapLanguages();
            } else {
                this.sourceLang = code;
            }
            this.ui.sourceMenuOpen = false;
            if (this.sourceText) this.translate();
        },

        /**
         * Sets the target language and triggers a translation.
         * @param {string} code - The language code to set.
         */
        selectTargetLang(code) {
            if (code === this.sourceLang) {
                this.swapLanguages();
            } else {
                this.targetLang = code;
            }
            this.ui.targetMenuOpen = false;
            if (this.sourceText) this.translate();
        },

        /**
         * Handles the opening and closing of language selection menus.
         * @param {boolean} isOpen - Whether the menu is open.
         * @param {'source'|'target'} type - The type of menu.
         */
        handleMenuToggle(isOpen, type) {
            const searchKey = `${type}Search`;
            if (isOpen) {
                this.$nextTick(() => this.$refs[`${type}SearchInput`].focus());
            } else {
                this.ui[searchKey] = '';
            }
        },

        /** @type {Array<object>} Computed property for filtered source languages. */
        get filteredSourceLanguages() {
            if (!this.ui.sourceSearch) return this.languages;
            return this.languages.filter(lang => lang.name.toLowerCase().includes(this.ui.sourceSearch.toLowerCase()));
        },

        /** @type {Array<object>} Computed property for available target languages based on the source. */
        get targetLanguages() {
            if (this.sourceLang === 'auto') return this.languages;
            const sourceLangObj = this.languages.find(l => l.code === this.sourceLang);
            if (!sourceLangObj) return this.languages;
            return this.languages.filter(l => sourceLangObj.targets.includes(l.code));
        },

        /** @type {Array<object>} Computed property for filtered target languages. */
        get filteredTargetLanguages() {
            const available = this.targetLanguages;
            if (!this.ui.targetSearch) return available;
            return available.filter(lang => lang.name.toLowerCase().includes(this.ui.targetSearch.toLowerCase()));
        },

        /**
         * Swaps the source and target languages and text.
         */
        swapLanguages() {
            if (this.sourceLang === 'auto') return;
            const targetLangObj = this.languages.find(l => l.code === this.targetLang);
            if (!targetLangObj || !targetLangObj.targets.includes(this.sourceLang)) {
                this.ui.error = `Cannot swap: ${this.getLanguageName(this.targetLang)} does not support translating to ${this.getLanguageName(this.sourceLang)}`;
                return;
            }
            [this.sourceLang, this.targetLang] = [this.targetLang, this.sourceLang];
            [this.sourceText, this.translatedText] = [this.translatedText, this.sourceText];
        },

        /**
         * Pastes text from the clipboard into the source text area.
         */
        async pasteFromClipboard() {
            try {
                const text = await navigator.clipboard.readText();
                this.sourceText = text;
                this.handleInput();
            } catch (err) {
                this.ui.error = 'Unable to access clipboard. Please grant permission in your browser.';
            }
        },

        /**
         * Handles user input in the source text area, debouncing translation.
         */
        handleInput() {
            this.ui.error = '';
            this.detectedLang = '';
            clearTimeout(this.translationTimeout);
            if (this.sourceText.trim()) {
                this.translationTimeout = setTimeout(() => this.translate(), config.debounceTimeout);
            } else {
                this.translatedText = '';
            }
        },

        /**
         * Validates that the target language is supported by the source language, switching if necessary.
         * @private
         * @param {string} sourceLang - The detected or selected source language code.
         */
        _validateTargetLanguage(sourceLang) {
            const sourceLangObj = this.languages.find(l => l.code === sourceLang);
            if (sourceLangObj && !sourceLangObj.targets.includes(this.targetLang)) {
                const newTarget = sourceLangObj.targets.includes('en') ? 'en' : sourceLangObj.targets[0];
                if (newTarget) {
                    this.targetLang = newTarget;
                } else {
                    throw new Error(`No valid target language for ${sourceLangObj.name}`);
                }
            }
        },

        /**
         * Performs the translation by calling the API.
         */
        async translate() {
            if (!this.sourceText.trim()) return;
            this.ui.isTranslating = true;
            this.ui.error = '';
            this.detectedLang = '';
            try {
                let actualSourceLang = this.sourceLang;
                if (this.sourceLang === 'auto') {
                    const detections = await apiService.detectLanguage(this.sourceText);
                    if (detections.length > 0 && detections[0].confidence > 0.5) {
                        actualSourceLang = detections[0].language;
                        this.detectedLang = actualSourceLang;
                    } else {
                        actualSourceLang = 'en'; // Fallback
                    }
                }
                this._validateTargetLanguage(actualSourceLang);
                const result = await apiService.translate(this.sourceText, actualSourceLang, this.targetLang);
                this.translatedText = result.translatedText;
            } catch (err) {
                this.ui.error = err.message || 'An unknown translation error occurred.';
                this.translatedText = '';
            } finally {
                this.ui.isTranslating = false;
            }
        },

        /**
         * Copies the translated text to the clipboard.
         */
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

        /**
         * Checks the connection to the API server.
         */
        async checkConnection() {
            try {
                await apiService.getLanguages();
                this.isConnected = true;
            } catch (err) {
                this.isConnected = false;
            }
        }
    };
}