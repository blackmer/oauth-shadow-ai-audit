/**
 * ui.js — Top-level orchestration for file import and dashboard rendering.
 *
 * Wires up the import panel, dispatches files to parsers, and stores
 * normalized results in the session state (memory only, no persistence).
 */

import { parseFile, mergeM3Results, detectFileType } from './ingest.js';

// ============================================================================
// Session state — lives in memory only, gone on reload
// ============================================================================

const state = {
    raw: {
        G1: null,  // parseG1 result
        G2: null,  // parseG2 result
        M1: null,  // parseM1 result
        M2: null,  // parseM2 result
        M3: [],    // array of parseM3 results (pagination support)
        M4: null,  // parseM4 result
    },
    // Merged M3 data (after pagination assembly)
    m3Merged: null,
};

// Expose state for console debugging during development
window.__auditState = state;

// ============================================================================
// File reading helper
// ============================================================================

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
        reader.readAsText(file);
    });
}

// ============================================================================
// Import panel logic
// ============================================================================

function updateSlotStatus(slotEl, result) {
    const statusEl = slotEl.querySelector('.slot-status');
    if (result.error) {
        statusEl.textContent = `Error: ${result.error}`;
        statusEl.className = 'slot-status status-error';
    } else {
        const count = result.data.length;
        const warnCount = result.warnings.length;
        let msg = `Loaded ${count} record${count !== 1 ? 's' : ''}`;
        if (warnCount > 0) msg += ` (${warnCount} warning${warnCount !== 1 ? 's' : ''})`;
        statusEl.textContent = msg;
        statusEl.className = 'slot-status status-ok';
    }

    // Log warnings to console for developer diagnosis
    if (result.warnings.length > 0) {
        console.warn(`[${result.slot || 'unknown'}] Warnings:`, result.warnings);
    }
}

function updateImportSummary() {
    const summaryEl = document.getElementById('import-summary');
    const resultsEl = document.getElementById('import-results');
    const slots = ['G1', 'G2', 'M1', 'M2', 'M3', 'M4'];
    const loaded = [];

    for (const slot of slots) {
        if (slot === 'M3') {
            if (state.raw.M3.length > 0) loaded.push(`M3 (${state.m3Merged?.data.length || 0} SPs)`);
        } else if (state.raw[slot]) {
            loaded.push(`${slot} (${state.raw[slot].data.length})`);
        }
    }

    if (loaded.length === 0) {
        summaryEl.classList.add('hidden');
        return;
    }

    summaryEl.classList.remove('hidden');
    resultsEl.textContent = `Files loaded: ${loaded.join(', ')}`;
}

async function handleFileInput(event) {
    const input = event.target;
    const slot = input.dataset.slot;
    const slotEl = input.closest('.import-slot');
    const files = input.files;

    if (!files || files.length === 0) return;

    for (const file of files) {
        try {
            const text = await readFileAsText(file);

            // Auto-detect if slot assignment seems wrong
            const detected = detectFileType(text, file.name);
            if (detected && detected !== slot) {
                console.warn(`File "${file.name}" looks like ${detected} but was placed in ${slot} slot`);
            }

            const result = parseFile(text, slot);

            if (slot === 'M3') {
                // M3 supports multiple files for pagination
                state.raw.M3.push(result);
                state.m3Merged = mergeM3Results(state.raw.M3);
                updateSlotStatus(slotEl, state.m3Merged);
            } else {
                state.raw[slot] = result;
                updateSlotStatus(slotEl, result);
            }
        } catch (err) {
            const statusEl = slotEl.querySelector('.slot-status');
            statusEl.textContent = `Error: ${err.message}`;
            statusEl.className = 'slot-status status-error';
            console.error(`[${slot}] File read error:`, err);
        }
    }

    updateImportSummary();
}

// ============================================================================
// Initialization
// ============================================================================

function init() {
    // Wire up file inputs
    const inputs = document.querySelectorAll('.import-slot input[type="file"]');
    for (const input of inputs) {
        input.addEventListener('change', handleFileInput);
    }

    console.log('[OAuth Audit Dashboard] Initialized. State available at window.__auditState');
}

document.addEventListener('DOMContentLoaded', init);
