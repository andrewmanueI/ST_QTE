const MODULE_NAME = 'quick_time_event';
const TOOL_NAME = 'start_qte_timer';
const DEFAULT_FALLBACK = "I couldn't think of anything to say.";
const EXTENSION_SCRIPT_URL = document.currentScript?.src ?? '';
const SETTINGS_TEMPLATE = `
<div id="qte_settings" class="quick-time-event-settings">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>Quick Time Event</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <label class="checkbox_label" for="qte_enabled">
                <input id="qte_enabled" type="checkbox" />
                <span>Enabled</span>
            </label>

            <label class="checkbox_label" for="qte_prompt_hint_enabled">
                <input id="qte_prompt_hint_enabled" type="checkbox" />
                <span>Prompt hint</span>
            </label>

            <div id="qte_tool_status" class="qte-tool-status"></div>

            <div class="qte-settings-grid">
                <label for="qte_default_seconds">Default seconds</label>
                <input id="qte_default_seconds" type="number" min="1" max="30" step="1" />

                <label for="qte_max_seconds">Max seconds</label>
                <input id="qte_max_seconds" type="number" min="1" max="30" step="1" />

                <label for="qte_fallback_text">Fallback text</label>
                <textarea id="qte_fallback_text" rows="3"></textarea>
            </div>
        </div>
    </div>
</div>`;

const defaultSettings = Object.freeze({
    enabled: true,
    promptHintEnabled: true,
    defaultSeconds: 10,
    maxSeconds: 30,
    fallbackText: DEFAULT_FALLBACK,
});

let activeQte = null;
let toolRegistered = false;

function getContext() {
    const hostApi = globalThis.SillyTavern ?? window['Silly' + 'Tavern'];
    return hostApi?.getContext?.() ?? {};
}

function getSettingsStore() {
    const context = getContext();
    return context.extensionSettings ?? window.extension_settings ?? {};
}

function getExtensionFolder() {
    const scriptSources = Array.from(document.scripts).map((script) => script.src);
    const scriptUrl = EXTENSION_SCRIPT_URL
        || document.currentScript?.src
        || scriptSources.find((src) => src.includes('/ST_QTE/') || src.includes('/quick-time-event/'))
        || scriptSources.find((src) => /\/scripts\/extensions\/.+\/index\.js(?:\?.*)?$/.test(src));
    const match = scriptUrl?.match(/\/scripts\/extensions\/(.+)\/index\.js(?:\?.*)?$/);

    return match?.[1] ?? 'third-party/ST_QTE';
}

function getSettings() {
    const store = getSettingsStore();

    if (!store[MODULE_NAME]) {
        store[MODULE_NAME] = structuredClone(defaultSettings);
    }

    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(store[MODULE_NAME], key)) {
            store[MODULE_NAME][key] = defaultSettings[key];
        }
    }

    normalizeSettings(store[MODULE_NAME]);
    return store[MODULE_NAME];
}

function normalizeSettings(settings) {
    settings.enabled = Boolean(settings.enabled);
    settings.promptHintEnabled = Boolean(settings.promptHintEnabled);
    settings.maxSeconds = clampInteger(settings.maxSeconds, 1, 30, defaultSettings.maxSeconds);
    settings.defaultSeconds = clampInteger(settings.defaultSeconds, 1, settings.maxSeconds, defaultSettings.defaultSeconds);

    if (typeof settings.fallbackText !== 'string' || !settings.fallbackText.trim()) {
        settings.fallbackText = DEFAULT_FALLBACK;
    }
}

function saveSettings() {
    const context = getContext();
    context.saveSettingsDebounced?.();
}

function clampInteger(value, min, max, fallback) {
    const number = Number.parseInt(value, 10);

    if (!Number.isFinite(number)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, number));
}

function singleLine(value) {
    return String(value ?? '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\s+/g, ' ')
        .trim();
}

function formatQteResult({ status, prompt = '', response = '', elapsedSeconds = 0 }) {
    const elapsed = Number.isFinite(elapsedSeconds) ? elapsedSeconds.toFixed(1) : '0.0';

    return [
        'QTE result:',
        `status: ${status}`,
        `prompt: ${singleLine(prompt)}`,
        `response: ${singleLine(response)}`,
        `elapsed_seconds: ${elapsed}`,
    ].join('\n');
}

function getToolDescription() {
    const baseDescription = 'Start a quick-time-event timer that asks the user to type an immediate response before time runs out.';

    if (!getSettings().promptHintEnabled) {
        return baseDescription;
    }

    return `${baseDescription} Use this only for urgent, tense, time-limited moments where the user's immediate choice, words, or reaction matters.`;
}

function canUseFunctionTools() {
    const context = getContext();

    if (typeof context.isToolCallingSupported !== 'function') {
        return false;
    }

    return Boolean(context.isToolCallingSupported());
}

function registerFunctionTool() {
    const context = getContext();
    const settings = getSettings();
    toolRegistered = false;

    if (typeof context.registerFunctionTool !== 'function' || typeof context.unregisterFunctionTool !== 'function') {
        console.info('Quick Time Event: function tools are not available in this build.');
        updateToolStatus();
        return;
    }

    context.unregisterFunctionTool(TOOL_NAME);

    if (!settings.enabled) {
        updateToolStatus();
        return;
    }

    context.registerFunctionTool({
        name: TOOL_NAME,
        displayName: 'Quick Time Event',
        description: getToolDescription(),
        parameters: {
            $schema: 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                prompt: {
                    type: 'string',
                    description: 'The urgent prompt to show to the user.',
                },
                seconds: {
                    type: 'integer',
                    minimum: 1,
                    maximum: settings.maxSeconds,
                    default: settings.defaultSeconds,
                    description: 'How many seconds the user has to answer. Capped by the extension settings.',
                },
                fallbackText: {
                    type: 'string',
                    default: settings.fallbackText,
                    description: 'Text to return if the user skips or runs out of time.',
                },
                intensity: {
                    type: 'string',
                    enum: ['low', 'medium', 'high', 'critical'],
                    default: 'high',
                    description: 'Visual intensity for the QTE card.',
                },
            },
            required: ['prompt'],
        },
        action: startQteTool,
        formatMessage: (args) => args?.prompt ? `Quick Time Event: ${singleLine(args.prompt)}` : 'Quick Time Event',
        shouldRegister: () => getSettings().enabled && canUseFunctionTools(),
        stealth: false,
    });

    toolRegistered = true;
    updateToolStatus();
}

async function startQteTool(args = {}) {
    const settings = getSettings();
    const startedAt = performance.now();

    if (!settings.enabled) {
        return formatQteResult({
            status: 'error',
            response: 'Quick Time Event is disabled.',
            elapsedSeconds: 0,
        });
    }

    if (!canUseFunctionTools()) {
        return formatQteResult({
            status: 'error',
            prompt: args?.prompt,
            response: 'Function calling is not supported or enabled for the current API connection.',
            elapsedSeconds: 0,
        });
    }

    if (activeQte) {
        return formatQteResult({
            status: 'error',
            prompt: args?.prompt,
            response: 'A Quick Time Event is already active.',
            elapsedSeconds: (performance.now() - startedAt) / 1000,
        });
    }

    const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';

    if (!prompt) {
        return formatQteResult({
            status: 'error',
            response: 'Missing required prompt.',
            elapsedSeconds: 0,
        });
    }

    const maxSeconds = clampInteger(settings.maxSeconds, 1, 30, defaultSettings.maxSeconds);
    const defaultSeconds = clampInteger(settings.defaultSeconds, 1, maxSeconds, defaultSettings.defaultSeconds);
    const seconds = clampInteger(args.seconds, 1, maxSeconds, defaultSeconds);
    const fallbackText = typeof args.fallbackText === 'string' && args.fallbackText.trim()
        ? args.fallbackText.trim()
        : settings.fallbackText;
    const intensity = ['low', 'medium', 'high', 'critical'].includes(args.intensity) ? args.intensity : 'high';

    return await renderQteCard({ prompt, seconds, fallbackText, intensity });
}

function renderQteCard({ prompt, seconds, fallbackText, intensity }) {
    return new Promise((resolve) => {
        const startedAt = performance.now();
        const card = document.createElement('div');
        card.className = `qte-card qte-intensity-${intensity}`;
        card.setAttribute('role', 'group');
        card.setAttribute('aria-live', 'polite');

        const header = document.createElement('div');
        header.className = 'qte-card-header';

        const title = document.createElement('div');
        title.className = 'qte-card-title';
        title.textContent = 'Quick Time Event';

        const timer = document.createElement('div');
        timer.className = 'qte-card-timer';

        header.append(title, timer);

        const promptElement = document.createElement('div');
        promptElement.className = 'qte-card-prompt';
        promptElement.textContent = prompt;

        const progressTrack = document.createElement('div');
        progressTrack.className = 'qte-progress-track';

        const progressFill = document.createElement('div');
        progressFill.className = 'qte-progress-fill';
        progressTrack.append(progressFill);

        const input = document.createElement('textarea');
        input.className = 'qte-card-input';
        input.rows = 2;
        input.placeholder = 'Type your response...';

        const controls = document.createElement('div');
        controls.className = 'qte-card-controls';

        const submitButton = document.createElement('button');
        submitButton.type = 'button';
        submitButton.className = 'menu_button qte-submit-button';
        submitButton.textContent = 'Submit';

        const skipButton = document.createElement('button');
        skipButton.type = 'button';
        skipButton.className = 'menu_button qte-skip-button';
        skipButton.textContent = 'Skip/Freeze';

        controls.append(submitButton, skipButton);
        card.append(header, promptElement, progressTrack, input, controls);
        appendQteCard(card);

        const finish = (status, response) => {
            if (!activeQte || activeQte.card !== card) {
                return;
            }

            clearInterval(activeQte.intervalId);
            clearTimeout(activeQte.timeoutId);

            const elapsedSeconds = (performance.now() - startedAt) / 1000;
            const result = formatQteResult({ status, prompt, response, elapsedSeconds });
            activeQte = null;

            input.disabled = true;
            submitButton.disabled = true;
            skipButton.disabled = true;
            updateCardSummary(card, { status, prompt, response, elapsedSeconds });
            resolve(result);
        };

        const updateCountdown = () => {
            const elapsedMs = performance.now() - startedAt;
            const remainingSeconds = Math.max(0, seconds - elapsedMs / 1000);
            const percentRemaining = Math.max(0, Math.min(100, (remainingSeconds / seconds) * 100));
            timer.textContent = `${remainingSeconds.toFixed(1)}s`;
            progressFill.style.width = `${percentRemaining}%`;
        };

        submitButton.addEventListener('click', () => {
            finish('answered', input.value.trim() || fallbackText);
        });

        skipButton.addEventListener('click', () => {
            finish('skipped', fallbackText);
        });

        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                finish('answered', input.value.trim() || fallbackText);
            }
        });

        activeQte = {
            card,
            intervalId: window.setInterval(updateCountdown, 100),
            timeoutId: window.setTimeout(() => finish('timeout', fallbackText), seconds * 1000),
        };

        updateCountdown();
        input.focus({ preventScroll: true });
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
}

function appendQteCard(card) {
    const chat = document.querySelector('#chat') ?? document.querySelector('#chat_container') ?? document.body;
    const wrapper = document.createElement('div');
    wrapper.className = 'qte-card-wrapper';
    wrapper.append(card);
    chat.append(wrapper);
}

function updateCardSummary(card, { status, prompt, response, elapsedSeconds }) {
    card.classList.add('qte-card-complete', `qte-status-${status}`);
    card.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'qte-card-header';

    const title = document.createElement('div');
    title.className = 'qte-card-title';
    title.textContent = 'QTE Complete';

    const badge = document.createElement('div');
    badge.className = 'qte-status-badge';
    badge.textContent = status;

    header.append(title, badge);

    const promptElement = document.createElement('div');
    promptElement.className = 'qte-card-prompt';
    promptElement.textContent = prompt;

    const responseElement = document.createElement('div');
    responseElement.className = 'qte-card-response';
    responseElement.textContent = response;

    const meta = document.createElement('div');
    meta.className = 'qte-card-meta';
    meta.textContent = `Elapsed ${elapsedSeconds.toFixed(1)}s`;

    card.append(header, promptElement, responseElement, meta);
}

async function renderSettings() {
    const context = getContext();
    const settings = getSettings();
    let html = SETTINGS_TEMPLATE;

    if (typeof context.renderExtensionTemplateAsync === 'function') {
        try {
            html = await context.renderExtensionTemplateAsync(getExtensionFolder(), 'settings');
        } catch (error) {
            console.warn('Quick Time Event: settings template failed to load; using inline fallback.', error);
        }
    }

    const container = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');

    if (!container) {
        console.warn('Quick Time Event: extension settings container was not found.');
        return;
    }

    container.insertAdjacentHTML('beforeend', html);
    bindSettings(settings);
    updateToolStatus();
}

function updateToolStatus() {
    const status = document.getElementById('qte_tool_status');

    if (!status) {
        return;
    }

    const context = getContext();
    const hasToolApi = typeof context.registerFunctionTool === 'function'
        && typeof context.unregisterFunctionTool === 'function';
    const supported = canUseFunctionTools();

    status.textContent = hasToolApi
        ? `Tool status: ${toolRegistered ? 'registered' : 'not registered'}; function calling ${supported ? 'enabled' : 'not enabled for this connection'}`
        : 'Tool status: function tool API unavailable';
}

function bindSettings(settings) {
    const enabled = document.getElementById('qte_enabled');
    const promptHintEnabled = document.getElementById('qte_prompt_hint_enabled');
    const defaultSeconds = document.getElementById('qte_default_seconds');
    const maxSeconds = document.getElementById('qte_max_seconds');
    const fallbackText = document.getElementById('qte_fallback_text');

    if (!enabled || !promptHintEnabled || !defaultSeconds || !maxSeconds || !fallbackText) {
        console.warn('Quick Time Event: settings controls were not found.');
        return;
    }

    enabled.checked = settings.enabled;
    promptHintEnabled.checked = settings.promptHintEnabled;
    defaultSeconds.value = settings.defaultSeconds;
    maxSeconds.value = settings.maxSeconds;
    fallbackText.value = settings.fallbackText;

    enabled.addEventListener('change', () => {
        settings.enabled = enabled.checked;
        registerFunctionTool();
        updateToolStatus();
        saveSettings();
    });

    promptHintEnabled.addEventListener('change', () => {
        settings.promptHintEnabled = promptHintEnabled.checked;
        registerFunctionTool();
        updateToolStatus();
        saveSettings();
    });

    defaultSeconds.addEventListener('input', () => {
        settings.defaultSeconds = clampInteger(defaultSeconds.value, 1, settings.maxSeconds, defaultSettings.defaultSeconds);
        defaultSeconds.value = settings.defaultSeconds;
        saveSettings();
    });

    maxSeconds.addEventListener('input', () => {
        settings.maxSeconds = clampInteger(maxSeconds.value, 1, 30, defaultSettings.maxSeconds);
        settings.defaultSeconds = clampInteger(settings.defaultSeconds, 1, settings.maxSeconds, defaultSettings.defaultSeconds);
        maxSeconds.value = settings.maxSeconds;
        defaultSeconds.value = settings.defaultSeconds;
        saveSettings();
    });

    fallbackText.addEventListener('input', () => {
        settings.fallbackText = fallbackText.value.trim() || DEFAULT_FALLBACK;
        saveSettings();
    });
}

jQuery(async () => {
    getSettings();
    await renderSettings();
    registerFunctionTool();
});
