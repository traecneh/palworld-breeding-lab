"use strict";

const DATA_URL = "./data/palworld-breeding-data.json";
const DATA_BASE_URL = new URL(DATA_URL, window.location.href);
const COMMON_RARITY_MAX = 3;
const SELF_PAIR_BASE_RARITY_MAX = 7;
const PAL_TOOLTIP_OFFSET = 14;
const PAL_TOOLTIP_VIEWPORT_MARGIN = 12;
const DEPENDENCY_GRAPH_LAYOUT = Object.freeze({
    paddingX: 56,
    paddingY: 44,
    columnSpan: 410,
    rowGap: 38,
    pairWidth: 320,
    pairHeight: 196,
    leafWidth: 244,
    leafHeight: 112,
    refWidth: 228,
    refHeight: 88,
    pairInputOffsetAY: 121,
    pairInputOffsetBY: 165,
    pairOutputOffsetY: 98,
    leafOutputOffsetY: 56,
    refOutputOffsetY: 44,
    viewportMinHeight: 620,
    panMargin: 72,
    minScale: 0.32,
    maxScale: 1.9,
    zoomStep: 1.18
});
const TARGET_ROUTE_VARIANT_LIMIT = 6;
const TARGET_ROUTE_CHILD_VARIANT_LIMIT = 3;
const TARGET_ROUTE_PAIR_SCAN_LIMIT = 18;
const WORK_SUITABILITY_DEFINITIONS = [
    { key: "Kindling", label: "Kindling" },
    { key: "Watering", label: "Watering" },
    { key: "Seeding", label: "Planting" },
    { key: "GenerateElectricity", label: "Electricity" },
    { key: "Handcraft", label: "Handiwork" },
    { key: "Gather", label: "Gathering" },
    { key: "Lumbering", label: "Lumbering" },
    { key: "Mining", label: "Mining" },
    { key: "MedicineProduction", label: "Medicine" },
    { key: "Cooling", label: "Cooling" },
    { key: "Transport", label: "Transport" },
    { key: "Farming", label: "Farming" },
    { key: "OilExtraction", label: "Oil" }
];

const state = {
    candidates: [],
    candidateById: new Map(),
    aliasToCandidateId: new Map(),
    pairsByChildId: new Map(),
    filteredCandidates: [],
    activeSuggestionIndex: -1,
    selectedId: null,
    assetVersion: "",
    bestTraceCache: new Map(),
    bestRouteCache: new Map(),
    routeSetCache: new Map(),
    activeDependencyView: null,
    palTooltip: null
};

const elements = {
    dataStatus: document.querySelector("#data-status"),
    dataGenerated: document.querySelector("#data-generated"),
    searchInput: document.querySelector("#pal-search"),
    clearButton: document.querySelector("#clear-search"),
    searchWorkSuitability: document.querySelector("#search-work-suitability"),
    searchWorkLevel: document.querySelector("#search-work-level"),
    searchRarity: document.querySelector("#search-rarity"),
    suggestions: document.querySelector("#pal-suggestions"),
    suggestionTemplate: document.querySelector("#suggestion-template"),
    resultTemplate: document.querySelector("#result-card-template"),
    summaryPanel: document.querySelector("#summary-panel"),
    emptyPanel: document.querySelector("#empty-panel"),
    resultsPanel: document.querySelector("#results-panel"),
    tracePanel: document.querySelector("#trace-panel"),
    selectedPalName: document.querySelector("#selected-pal-name"),
    selectedPalRarity: document.querySelector("#selected-pal-rarity"),
    selectedPalCount: document.querySelector("#selected-pal-count"),
    resultsTitle: document.querySelector("#results-title"),
    uniqueCount: document.querySelector("#unique-count"),
    formulaCount: document.querySelector("#formula-count"),
    resultsBody: document.querySelector("#results-body"),
    resultsList: document.querySelector("#results-list"),
    resultsToggle: document.querySelector("#results-toggle"),
    traceBackButton: document.querySelector("#trace-back-button"),
    traceSortMode: document.querySelector("#trace-sort-mode"),
    traceMaxDepth: document.querySelector("#trace-max-depth"),
    traceRequiredBasePal: document.querySelector("#trace-required-base-pal"),
    traceTitle: document.querySelector("#trace-title"),
    traceStatus: document.querySelector("#trace-status"),
    traceBody: document.querySelector("#trace-body"),
    traceToggle: document.querySelector("#trace-toggle"),
    traceList: document.querySelector("#trace-list")
};

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
    bindEvents();
    initializePalTooltip();

    try {
        const response = await fetch(DATA_URL, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`Failed to load ${DATA_URL} (${response.status})`);
        }

        const exportData = await response.json();
        state.assetVersion = buildAssetVersion(exportData);
        buildLookupState(exportData);
        updateHeaderStatus(exportData);

        const initialId = decodeURIComponent(window.location.hash.replace(/^#/, ""));
        if (initialId && state.candidateById.has(initialId)) {
            selectCandidate(initialId);
        } else {
            renderIdleState();
        }
    } catch (error) {
        renderLoadError(error);
    }
}

function bindEvents() {
    elements.searchInput.addEventListener("input", handleSearchInput);
    elements.searchInput.addEventListener("focus", handleSearchFocus);
    elements.searchInput.addEventListener("keydown", handleSearchKeydown);
    elements.clearButton.addEventListener("click", clearSelection);
    elements.searchWorkSuitability.addEventListener("change", handleSearchInput);
    elements.searchWorkLevel.addEventListener("change", handleSearchInput);
    elements.searchRarity.addEventListener("change", handleSearchInput);
    elements.resultsToggle.addEventListener("click", () => toggleSectionCollapsed("results"));
    elements.traceToggle.addEventListener("click", () => toggleSectionCollapsed("trace"));
    elements.traceBackButton.addEventListener("click", handleTraceBack);
    elements.traceSortMode.addEventListener("change", handleTraceSortModeChange);
    elements.traceMaxDepth.addEventListener("change", handleTraceDepthChange);
    elements.traceRequiredBasePal.addEventListener("change", handleTraceRequiredBasePalChange);
    elements.traceList.addEventListener("click", handleTraceListClick);

    document.addEventListener("click", (event) => {
        if (!event.target.closest("#pal-combobox")) {
            hideSuggestions();
        }
    });

    window.addEventListener("resize", handleWindowResize);

    window.addEventListener("hashchange", () => {
        const requestedId = decodeURIComponent(window.location.hash.replace(/^#/, ""));
        if (requestedId && state.candidateById.has(requestedId) && requestedId !== state.selectedId) {
            selectCandidate(requestedId, { syncHash: false });
        }
    });
}

function handleTraceListClick(event) {
    const stepRef = event.target.closest("[data-step-ref]");
    if (!stepRef) {
        return;
    }

    const stepNumber = stepRef.getAttribute("data-step-ref");
    if (!stepNumber) {
        return;
    }

    const activeView = state.activeDependencyView;
    if (activeView) {
        focusDependencyStep(stepNumber);
        return;
    }

    const target = document.getElementById(`dependency-step-${stepNumber}`);
    if (!target) {
        return;
    }

    target.scrollIntoView({
        behavior: "smooth",
        block: "center"
    });
    target.classList.remove("is-highlighted");
    void target.offsetWidth;
    target.classList.add("is-highlighted");

    window.clearTimeout(target._dependencyHighlightTimeout);
    target._dependencyHighlightTimeout = window.setTimeout(() => {
        target.classList.remove("is-highlighted");
    }, 1800);
}

function handleWindowResize() {
    if (!state.activeDependencyView) {
        return;
    }

    fitDependencyGraphView(state.activeDependencyView);
}

function buildLookupState(exportData) {
    const palMetadataByTribeId = buildPalMetadataLookup(exportData.Pals);
    const allCandidates = exportData.BreedingCandidates
        .map((candidate) => normalizeCandidate(candidate, palMetadataByTribeId));

    const hiddenCandidateIds = new Set(
        allCandidates
            .filter((candidate) => candidate.combiRank === 0 || /^\d+$/.test(candidate.displayName))
            .map((candidate) => candidate.id)
    );

    const candidates = allCandidates
        .filter((candidate) => !hiddenCandidateIds.has(candidate.id))
        .sort(compareCandidates);

    const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const aliasToCandidateId = new Map();

    for (const candidate of candidates) {
        registerAlias(aliasToCandidateId, candidate.id, candidate.id);
        registerAlias(aliasToCandidateId, normalizeIdentifier(candidate.id), candidate.id);
        registerAlias(aliasToCandidateId, candidate.displayName, candidate.id);
        registerAlias(aliasToCandidateId, normalizeIdentifier(candidate.displayName), candidate.id);
    }

    for (const pal of exportData.Pals) {
        if (!candidateById.has(pal.TribeName)) {
            continue;
        }

        registerAlias(aliasToCandidateId, pal.RawName, pal.TribeName);
        registerAlias(aliasToCandidateId, stripKnownPrefixes(pal.RawName), pal.TribeName);
        registerAlias(aliasToCandidateId, normalizeIdentifier(pal.RawName), pal.TribeName);
        registerAlias(aliasToCandidateId, normalizeIdentifier(stripKnownPrefixes(pal.RawName)), pal.TribeName);
    }

    const pairsByChildId = new Map();
    for (const pair of exportData.InferredPairs) {
        const childId = resolveChildId(pair, candidateById, aliasToCandidateId);
        if (!childId) {
            continue;
        }

        const normalizedPair = normalizePair(pair, candidateById, aliasToCandidateId, childId);
        if (!normalizedPair) {
            continue;
        }

        if (!pairsByChildId.has(childId)) {
            pairsByChildId.set(childId, []);
        }

        pairsByChildId.get(childId).push(normalizedPair);
    }

    for (const pairList of pairsByChildId.values()) {
        pairList.sort(comparePairs);
    }

    state.candidates = candidates;
    state.candidateById = candidateById;
    state.aliasToCandidateId = aliasToCandidateId;
    state.pairsByChildId = pairsByChildId;
    state.bestTraceCache.clear();
    state.bestRouteCache.clear();
    state.routeSetCache.clear();

    populateSearchRarityOptions(candidates);
    populateRequiredBasePalOptions(candidates);
}

function populateRequiredBasePalOptions(candidates) {
    const previousValue = elements.traceRequiredBasePal.value;
    elements.traceRequiredBasePal.replaceChildren();

    const anyOption = document.createElement("option");
    anyOption.value = "";
    anyOption.textContent = "Any Base Pal";
    elements.traceRequiredBasePal.appendChild(anyOption);

    candidates.forEach((candidate) => {
        const option = document.createElement("option");
        option.value = candidate.id;
        option.textContent = candidate.displayName;
        elements.traceRequiredBasePal.appendChild(option);
    });

    if (previousValue && state.candidateById.has(previousValue)) {
        elements.traceRequiredBasePal.value = previousValue;
    }
}

function normalizeCandidate(candidate, palMetadataByTribeId) {
    const tribeName = String(candidate.TribeName ?? "").trim();
    const displayName = cleanDisplayName(candidate.DisplayName, tribeName);
    const tribeLabel = tribeName === displayName ? "" : tribeName;
    const metadata = palMetadataByTribeId.get(tribeName) ?? null;
    const rarityValue = metadata?.rarityValue ?? null;
    const workSuitabilities = metadata?.workSuitabilities ?? {};
    const iconPath = resolveDataAssetUrl(candidate.IconThumbnailPath ?? candidate.IconPath);

    return {
        id: tribeName,
        displayName,
        tribeName,
        tribeLabel,
        iconPath,
        combiRank: Number(candidate.CombiRank ?? 0),
        rarityValue,
        rarity: rarityValue === null ? null : describeRarity(rarityValue),
        workSuitabilities,
        elementTypes: metadata?.elementTypes ?? [],
        hp: metadata?.hp ?? null,
        meleeAttack: metadata?.meleeAttack ?? null,
        shotAttack: metadata?.shotAttack ?? null,
        defense: metadata?.defense ?? null,
        foodAmount: metadata?.foodAmount ?? null,
        walkSpeed: metadata?.walkSpeed ?? null,
        runSpeed: metadata?.runSpeed ?? null,
        rideSprintSpeed: metadata?.rideSprintSpeed ?? null,
        workSpeed: metadata?.workSpeed ?? null,
        possibleDrops: metadata?.possibleDrops ?? [],
        isNocturnal: metadata?.isNocturnal ?? false,
        isPredator: metadata?.isPredator ?? false,
        maleProbability: metadata?.maleProbability ?? null,
        searchText: buildCandidateSearchText(displayName, tribeName, workSuitabilities)
    };
}

function buildPalMetadataLookup(pals) {
    const lookup = new Map();
    for (const pal of pals) {
        if (pal.IsBoss || pal.IsTowerBoss) {
            continue;
        }

        const tribeName = String(pal.TribeName ?? "").trim();
        if (!tribeName || lookup.has(tribeName)) {
            continue;
        }

        const workSuitabilities = {};
        for (const definition of WORK_SUITABILITY_DEFINITIONS) {
            workSuitabilities[definition.key] = Number(pal[definition.key] ?? 0);
        }

        lookup.set(tribeName, {
            rarityValue: Number(pal.Rarity ?? 0),
            workSuitabilities,
            elementTypes: buildPalElementTypes(pal),
            hp: normalizePositiveNumber(pal.Hp),
            meleeAttack: normalizePositiveNumber(pal.MeleeAttack),
            shotAttack: normalizePositiveNumber(pal.ShotAttack),
            defense: normalizePositiveNumber(pal.Defense),
            foodAmount: normalizePositiveNumber(pal.FoodAmount),
            walkSpeed: normalizePositiveNumber(pal.WalkSpeed),
            runSpeed: normalizePositiveNumber(pal.RunSpeed),
            rideSprintSpeed: normalizePositiveNumber(pal.RideSprintSpeed),
            workSpeed: normalizeWorkSpeed(pal.CraftSpeed),
            possibleDrops: normalizePalDropEntries(pal.PossibleDrops),
            isNocturnal: Boolean(pal.IsNocturnal),
            isPredator: Boolean(pal.IsPredator),
            maleProbability: normalizePercentNumber(pal.MaleProbability)
        });
    }

    return lookup;
}

function buildPalElementTypes(pal) {
    const elementTypes = [];

    for (const rawValue of [pal?.ElementType1, pal?.ElementType2]) {
        const value = String(rawValue ?? "").trim();
        if (!value || value === "None" || elementTypes.includes(value)) {
            continue;
        }

        elementTypes.push(value);
    }

    return elementTypes;
}

function normalizePositiveNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizePercentNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

function normalizeWorkSpeed(value) {
    const parsed = normalizePositiveNumber(value);
    return parsed === 100 ? null : parsed;
}

function resolveDataAssetUrl(relativePath) {
    const normalized = String(relativePath ?? "").trim();
    if (!normalized) {
        return null;
    }

    try {
        const assetUrl = new URL(normalized, DATA_BASE_URL);
        if (state.assetVersion) {
            assetUrl.searchParams.set("v", state.assetVersion);
        }

        return assetUrl.href;
    } catch {
        return null;
    }
}

function buildAssetVersion(exportData) {
    const generatedAt = String(exportData?.GeneratedAtUtc ?? "").trim();
    if (generatedAt) {
        return generatedAt;
    }

    return String(Date.now());
}

function buildCandidateSearchText(displayName, tribeName, workSuitabilities) {
    const workSearch = WORK_SUITABILITY_DEFINITIONS
        .filter((definition) => Number(workSuitabilities[definition.key] ?? 0) > 0)
        .map((definition) => definition.label)
        .join(" ");

    return `${displayName} ${humanizeIdentifier(tribeName)} ${tribeName} ${workSearch}`.toLowerCase();
}

function populateSearchRarityOptions(candidates) {
    const rarityValues = Array.from(new Set(
        candidates
            .map((candidate) => candidate.rarityValue)
            .filter((rarityValue) => Number.isFinite(rarityValue))
    )).sort((left, right) => left - right);

    const previousValue = elements.searchRarity.value;
    elements.searchRarity.replaceChildren();

    const anyOption = document.createElement("option");
    anyOption.value = "";
    anyOption.textContent = "Any Rarity";
    elements.searchRarity.appendChild(anyOption);

    rarityValues.forEach((rarityValue) => {
        const option = document.createElement("option");
        option.value = String(rarityValue);
        option.textContent = formatRarityValue(rarityValue);
        elements.searchRarity.appendChild(option);
    });

    if (rarityValues.includes(Number(previousValue))) {
        elements.searchRarity.value = previousValue;
    }
}

function describeRarity(rarityValue) {
    if (rarityValue === 20) {
        return {
            label: "Legendary",
            value: rarityValue,
            className: "badge-rarity-legendary"
        };
    }

    if (rarityValue >= 8) {
        return {
            label: "Epic",
            value: rarityValue,
            className: "badge-rarity-epic"
        };
    }

    if (rarityValue >= 4) {
        return {
            label: "Rare",
            value: rarityValue,
            className: "badge-rarity-rare"
        };
    }

    return {
        label: "Common",
        value: rarityValue,
        className: "badge-rarity-common"
    };
}

function normalizePair(pair, candidateById, aliasToCandidateId, childId) {
    const child = candidateById.get(childId) ?? null;
    if (!child) {
        return null;
    }

    const parentA = resolvePalReference(pair.ParentATribeName, pair.ParentADisplayName, candidateById, aliasToCandidateId);
    const parentB = resolvePalReference(pair.ParentBTribeName, pair.ParentBDisplayName, candidateById, aliasToCandidateId);
    if (!parentA || !parentB) {
        return null;
    }

    return {
        childId,
        childDisplayName: child?.displayName ?? cleanDisplayName(pair.ChildDisplayName, pair.ChildRawId),
        childTribeName: child?.tribeName ?? cleanDisplayName(pair.ChildTribeName, pair.ChildRawId),
        rule: pair.ResolutionKind,
        averageCombiRank: pair.AverageCombiRank,
        childCombiRank: pair.ChildCombiRank,
        parentA,
        parentAGenderRequirement: normalizeGender(pair.ParentAGenderRequirement),
        parentB,
        parentBGenderRequirement: normalizeGender(pair.ParentBGenderRequirement)
    };
}

function resolveChildId(pair, candidateById, aliasToCandidateId) {
    if (pair.ChildTribeName && candidateById.has(pair.ChildTribeName)) {
        return pair.ChildTribeName;
    }

    const directRawId = lookupAlias(aliasToCandidateId, pair.ChildRawId);
    if (directRawId) {
        return directRawId;
    }

    const normalizedRawId = lookupAlias(aliasToCandidateId, normalizeIdentifier(pair.ChildRawId));
    if (normalizedRawId) {
        return normalizedRawId;
    }

    return null;
}

function resolvePalReference(tribeName, displayName, candidateById, aliasToCandidateId) {
    const directCandidate = candidateById.get(tribeName);
    if (directCandidate) {
        return directCandidate;
    }

    const aliasId = lookupAlias(aliasToCandidateId, tribeName) ?? lookupAlias(aliasToCandidateId, normalizeIdentifier(tribeName));
    if (aliasId && candidateById.has(aliasId)) {
        return candidateById.get(aliasId);
    }

    return null;
}

function updateHeaderStatus(exportData) {
    const generatedAt = exportData.GeneratedAtUtc ? new Date(exportData.GeneratedAtUtc) : null;

    elements.dataStatus.textContent = `Loaded ${state.candidates.length} breedable pals`;
    elements.dataGenerated.textContent = generatedAt && !Number.isNaN(generatedAt.valueOf())
        ? `Extracted ${generatedAt.toLocaleString()}`
        : "Local extract ready";
}

function handleSearchInput() {
    const query = elements.searchInput.value.trim().toLowerCase();
    if (!query) {
        if (document.activeElement !== elements.searchInput) {
            state.filteredCandidates = [];
            state.activeSuggestionIndex = -1;
            hideSuggestions();
            return;
        }
    }

    state.filteredCandidates = filterCandidates(query);
    state.activeSuggestionIndex = state.filteredCandidates.length > 0 ? 0 : -1;
    renderSuggestions();
}

function handleSearchFocus() {
    state.filteredCandidates = filterCandidates(elements.searchInput.value.trim().toLowerCase());
    state.activeSuggestionIndex = state.filteredCandidates.length > 0 ? 0 : -1;
    renderSuggestions();
}

function handleSearchKeydown(event) {
    if (elements.suggestions.hidden && event.key !== "Enter") {
        return;
    }

    if (event.key === "ArrowDown") {
        event.preventDefault();
        moveActiveSuggestion(1);
        return;
    }

    if (event.key === "ArrowUp") {
        event.preventDefault();
        moveActiveSuggestion(-1);
        return;
    }

    if (event.key === "Enter") {
        event.preventDefault();
        if (state.filteredCandidates.length === 0) {
            return;
        }

        const candidate = state.filteredCandidates[Math.max(state.activeSuggestionIndex, 0)];
        if (candidate) {
            selectCandidate(candidate.id);
        }
        return;
    }

    if (event.key === "Escape") {
        hideSuggestions();
    }
}

function moveActiveSuggestion(direction) {
    if (state.filteredCandidates.length === 0) {
        return;
    }

    const nextIndex = state.activeSuggestionIndex < 0
        ? 0
        : (state.activeSuggestionIndex + direction + state.filteredCandidates.length) % state.filteredCandidates.length;

    state.activeSuggestionIndex = nextIndex;
    renderSuggestions();
}

function filterCandidates(query) {
    const filters = buildSearchFilters();
    if (!query) {
        return state.candidates
            .filter((candidate) => candidateMatchesSearchFilters(candidate, filters))
            .slice(0, 14);
    }

    const startsWith = [];
    const contains = [];

    for (const candidate of state.candidates) {
        if (!candidateMatchesSearchFilters(candidate, filters)) {
            continue;
        }

        if (candidate.searchText.startsWith(query)) {
            startsWith.push(candidate);
        } else if (candidate.searchText.includes(query)) {
            contains.push(candidate);
        }
    }

    return startsWith.concat(contains).slice(0, 14);
}

function renderSuggestions() {
    const suggestions = state.filteredCandidates;
    const filters = buildSearchFilters();
    const previousScrollTop = elements.suggestions.querySelector(".suggestions-list")?.scrollTop ?? 0;
    elements.suggestions.replaceChildren();

    if (suggestions.length === 0) {
        hideSuggestions();
        return;
    }

    state.activeSuggestionIndex = getNormalizedActiveSuggestionIndex(suggestions);

    const layout = document.createElement("div");
    layout.className = "suggestions-layout";

    const list = document.createElement("div");
    list.className = "suggestions-list";

    const fragment = document.createDocumentFragment();
    let activeNode = null;

    suggestions.forEach((candidate, index) => {
        const node = elements.suggestionTemplate.content.firstElementChild.cloneNode(true);
        const isActive = index === state.activeSuggestionIndex;
        node.querySelector(".suggestion-main").replaceChildren(
            createPalIdentity(candidate, { variant: "suggestion", link: false, tooltip: false, loading: "eager" })
        );
        node.querySelector(".suggestion-meta").textContent = buildSuggestionMeta(candidate, filters);
        node.dataset.id = candidate.id;
        node.id = `pal-suggestion-${candidate.id}`;
        node.setAttribute("aria-selected", String(isActive));
        node.classList.toggle("is-active", isActive);
        node.addEventListener("mouseenter", () => {
            if (index === state.activeSuggestionIndex) {
                return;
            }

            state.activeSuggestionIndex = index;
            renderSuggestions();
        });
        node.addEventListener("focus", () => {
            if (index === state.activeSuggestionIndex) {
                return;
            }

            state.activeSuggestionIndex = index;
            renderSuggestions();
        });
        node.addEventListener("click", () => selectCandidate(candidate.id));

        if (isActive) {
            activeNode = node;
        }

        fragment.appendChild(node);
    });

    list.appendChild(fragment);
    layout.append(
        list,
        buildSuggestionPreview(getActiveSuggestionCandidate(suggestions))
    );

    elements.suggestions.appendChild(layout);
    elements.suggestions.hidden = false;
    list.scrollTop = previousScrollTop;
    activeNode?.scrollIntoView({ block: "nearest" });
    updateSearchInputSuggestionState(activeNode?.id ?? "");
}

function hideSuggestions() {
    elements.suggestions.hidden = true;
    elements.suggestions.replaceChildren();
    updateSearchInputSuggestionState("");
}

function clearSelection() {
    hidePalTooltip();
    state.selectedId = null;
    elements.searchInput.value = "";
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    hideSuggestions();
    renderIdleState();
}

function buildSearchFilters() {
    const workSuitability = elements.searchWorkSuitability.value;
    const workLevel = Number.parseInt(elements.searchWorkLevel.value, 10);
    const rarityValue = Number.parseInt(elements.searchRarity.value, 10);

    return {
        workSuitability,
        workLevel: Number.isFinite(workLevel) ? workLevel : null,
        rarityValue: Number.isFinite(rarityValue) ? rarityValue : null
    };
}

function candidateMatchesSearchFilters(candidate, filters) {
    if (filters.rarityValue !== null && candidate.rarityValue !== filters.rarityValue) {
        return false;
    }

    return candidateMatchesWorkFilters(candidate, filters.workSuitability, filters.workLevel);
}

function candidateMatchesWorkFilters(candidate, workSuitability, workLevel) {
    const levels = candidate.workSuitabilities ?? {};

    if (workSuitability) {
        const level = Number(levels[workSuitability] ?? 0);
        if (level <= 0) {
            return false;
        }

        return workLevel === null ? true : level === workLevel;
    }

    if (workLevel === null) {
        return true;
    }

    return WORK_SUITABILITY_DEFINITIONS.some((definition) => Number(levels[definition.key] ?? 0) === workLevel);
}

function buildSuggestionMeta(candidate, filters) {
    const parts = [];

    if (candidate.rarity) {
        parts.push(formatRarity(candidate.rarity));
    }

    if (filters.workSuitability) {
        const level = Number(candidate.workSuitabilities?.[filters.workSuitability] ?? 0);
        const definition = WORK_SUITABILITY_DEFINITIONS.find((entry) => entry.key === filters.workSuitability);
        if (level > 0 && definition) {
            parts.push(`${definition.label} ${level}`);
        }
    } else if (filters.workLevel !== null) {
        const matches = WORK_SUITABILITY_DEFINITIONS
            .filter((definition) => Number(candidate.workSuitabilities?.[definition.key] ?? 0) === filters.workLevel)
            .map((definition) => definition.label);

        if (matches.length > 0) {
            parts.push(`${matches[0]} ${filters.workLevel}`);
        }
    }

    return parts.join(" · ");
}

function getNormalizedActiveSuggestionIndex(suggestions = state.filteredCandidates) {
    if (suggestions.length === 0) {
        return -1;
    }

    if (state.activeSuggestionIndex >= 0 && state.activeSuggestionIndex < suggestions.length) {
        return state.activeSuggestionIndex;
    }

    return 0;
}

function getActiveSuggestionCandidate(suggestions = state.filteredCandidates) {
    const index = getNormalizedActiveSuggestionIndex(suggestions);
    return index >= 0 ? suggestions[index] ?? null : null;
}

function buildSuggestionPreview(candidate) {
    const preview = document.createElement("aside");
    preview.className = "suggestion-preview";

    if (!candidate) {
        return preview;
    }

    const label = document.createElement("p");
    label.className = "suggestion-preview-label";
    label.textContent = "Preview";

    const panel = buildPalTooltipCard(candidate);
    panel.classList.add("suggestion-preview-card");

    preview.append(label, panel);
    return preview;
}

function updateSearchInputSuggestionState(activeOptionId) {
    elements.searchInput.setAttribute("aria-controls", "pal-suggestions");
    elements.searchInput.setAttribute("aria-expanded", String(!elements.suggestions.hidden));

    if (activeOptionId) {
        elements.searchInput.setAttribute("aria-activedescendant", activeOptionId);
    } else {
        elements.searchInput.removeAttribute("aria-activedescendant");
    }
}

function selectCandidate(candidateId, options = { syncHash: true }) {
    const candidate = state.candidateById.get(candidateId);
    if (!candidate) {
        return;
    }

    hidePalTooltip();
    state.selectedId = candidateId;
    elements.searchInput.value = candidate.displayName;
    hideSuggestions();

    if (options.syncHash) {
        window.location.hash = encodeURIComponent(candidateId);
    }

    renderSelectedCandidate(candidate);
}

function renderIdleState() {
    hidePalTooltip();
    elements.summaryPanel.hidden = true;
    elements.resultsPanel.hidden = true;
    elements.emptyPanel.hidden = false;
    elements.resultsList.replaceChildren();
    elements.selectedPalName.textContent = "No Pal selected";
    setSectionCollapsed("results", false);
    resetTracePanel();
}

function renderSelectedCandidate(candidate) {
    const results = state.pairsByChildId.get(candidate.id) ?? [];
    const uniqueCount = results.filter((pair) => pair.rule === "unique_combo").length;
    const formulaCount = results.length - uniqueCount;

    elements.emptyPanel.hidden = true;
    elements.summaryPanel.hidden = false;
    elements.resultsPanel.hidden = false;
    setSectionCollapsed("results", false);

    elements.selectedPalName.replaceChildren(createPalIdentity(candidate, { variant: "summary", loading: "eager" }));
    elements.selectedPalRarity.textContent = formatRarity(candidate.rarity);
    elements.selectedPalCount.textContent = String(results.length);

    elements.resultsTitle.textContent = `${results.length} breeding combinations`;
    elements.uniqueCount.textContent = String(uniqueCount);
    elements.formulaCount.textContent = String(formulaCount);

    if (results.length === 0) {
        renderEmptyResults(candidate);
        resetTracePanel(candidate);
        return;
    }

    const fragment = document.createDocumentFragment();
    results.forEach((pair) => fragment.appendChild(renderResultCard(pair)));
    elements.resultsList.replaceChildren(fragment);
    resetTracePanel(candidate);
}

function renderEmptyResults(candidate) {
    const empty = document.createElement("div");
    empty.className = "empty-message";
    empty.textContent = `No breeding combinations were found for ${candidate.displayName} in the current local extract.`;
    elements.resultsList.replaceChildren(empty);
}

function renderLoadError(error) {
    hidePalTooltip();
    elements.dataStatus.textContent = "Failed to load local breeding data";
    elements.dataGenerated.textContent = "";
    elements.summaryPanel.hidden = true;
    elements.resultsPanel.hidden = false;
    elements.emptyPanel.hidden = true;
    elements.selectedPalName.textContent = "No Pal selected";
    setSectionCollapsed("results", false);
    resetTracePanel();

    const errorNode = document.createElement("div");
    errorNode.className = "empty-message error-message";
    errorNode.textContent = `The site could not read ${DATA_URL}. Run the extractor first, then launch the site with the PowerShell start script. ${error instanceof Error ? error.message : ""}`.trim();
    elements.resultsList.replaceChildren(errorNode);
}

function handleTraceBack() {
    runTraceBack({ collapseResults: true });
}

function runTraceBack({ collapseResults = false } = {}) {
    const candidate = state.selectedId ? state.candidateById.get(state.selectedId) : null;
    if (!candidate) {
        return;
    }

    const maxDepth = readTraceMaxDepth();
    const sortMode = readTraceSortMode();
    const requiredBasePalId = readTraceRequiredBasePalId();
    const traceResult = searchBestTraceResult(candidate.id, maxDepth, sortMode, requiredBasePalId);

    if (collapseResults) {
        setSectionCollapsed("results", true);
    }

    renderTraceResults(candidate, traceResult);
}

function handleTraceSortModeChange() {
    const candidate = state.selectedId ? state.candidateById.get(state.selectedId) : null;
    if (!candidate || elements.tracePanel.hidden) {
        return;
    }

    runTraceBack();
}

function handleTraceDepthChange() {
    const candidate = state.selectedId ? state.candidateById.get(state.selectedId) : null;
    if (!candidate || elements.tracePanel.hidden) {
        return;
    }

    runTraceBack();
}

function handleTraceRequiredBasePalChange() {
    const candidate = state.selectedId ? state.candidateById.get(state.selectedId) : null;
    if (!candidate || elements.tracePanel.hidden) {
        return;
    }

    runTraceBack();
}

function resetTracePanel(candidate = null) {
    disposeActiveDependencyView();
    const requiredBasePalId = readTraceRequiredBasePalId();
    const requiredBaseCandidate = requiredBasePalId
        ? state.candidateById.get(requiredBasePalId) ?? null
        : null;
    elements.tracePanel.hidden = true;
    elements.traceList.replaceChildren();
    elements.traceTitle.textContent = candidate
        ? `Best route for ${candidate.displayName}`
        : "Best Route";
    elements.traceStatus.textContent = candidate
        ? (requiredBaseCandidate
            ? `Choose Best Route to build the recursive breeding chain using ${requiredBaseCandidate.displayName} as a base.`
            : "Choose Best Route to build the recursive breeding chain.")
        : "Choose a Pal to build its best route.";
    setSectionCollapsed("trace", false);
}

function readTraceSortMode() {
    return elements.traceSortMode.value === "generations" ? "generations" : "rarity";
}

function readTraceRequiredBasePalId() {
    const requiredBasePalId = String(elements.traceRequiredBasePal.value ?? "").trim();
    return requiredBasePalId && state.candidateById.has(requiredBasePalId)
        ? requiredBasePalId
        : null;
}

function toggleSectionCollapsed(sectionName) {
    const body = getSectionBody(sectionName);
    setSectionCollapsed(sectionName, !body.hidden);
}

function setSectionCollapsed(sectionName, collapsed) {
    const body = getSectionBody(sectionName);
    const toggle = getSectionToggle(sectionName);

    body.hidden = collapsed;
    toggle.textContent = collapsed ? "Expand" : "Collapse";
    toggle.setAttribute("aria-expanded", String(!collapsed));
}

function getSectionBody(sectionName) {
    return sectionName === "trace" ? elements.traceBody : elements.resultsBody;
}

function getSectionToggle(sectionName) {
    return sectionName === "trace" ? elements.traceToggle : elements.resultsToggle;
}

function searchBestTraceResult(targetId, maxDepth, sortMode, requiredBasePalId = null) {
    const cacheKey = getBestTraceCacheKey(targetId, maxDepth, sortMode, requiredBasePalId);
    const cachedResult = state.bestTraceCache.get(cacheKey);
    if (cachedResult) {
        return cachedResult;
    }

    const candidate = state.candidateById.get(targetId);
    const route = candidate
        ? (requiredBasePalId
            ? findBestRouteWithRequiredBase(candidate, maxDepth, sortMode, requiredBasePalId)
            : solveBestTraceRoute(candidate, maxDepth, new Set(), sortMode, null, true))
        : null;

    const result = {
        targetId,
        maxDepth,
        sortMode,
        requiredBasePalId,
        route
    };

    state.bestTraceCache.set(cacheKey, result);
    return result;
}

function findBestRouteWithRequiredBase(targetCandidate, maxDepth, sortMode, requiredBasePalId) {
    const targetRoutes = solveTraceRouteSet(
        targetCandidate,
        maxDepth,
        new Set(),
        sortMode,
        true,
        TARGET_ROUTE_VARIANT_LIMIT
    );
    if (targetRoutes.length === 0) {
        return null;
    }

    let bestRoute = null;

    for (const targetRoute of targetRoutes) {
        if (routeContainsBasePal(targetRoute, requiredBasePalId)) {
            const directRoute = cloneRouteMarkingRequiredBase(targetRoute, requiredBasePalId);
            if (!bestRoute || compareTraceRoutes(directRoute, bestRoute, sortMode, requiredBasePalId) < 0) {
                bestRoute = directRoute;
            }
        }

        const anchors = collectRouteAnchorsForRequiredBase(targetRoute, maxDepth);
        for (const anchor of anchors) {
            if (anchor.remainingDepth <= 0) {
                continue;
            }

            const replacementRoute = solveBestTraceRoute(
                anchor.candidate,
                anchor.remainingDepth,
                anchor.ancestry,
                sortMode,
                requiredBasePalId,
                anchor.path.length === 0
            );
            if (!replacementRoute || !replacementRoute.containsRequiredBase) {
                continue;
            }

            const candidateRoute = replaceRouteAtPath(targetRoute, anchor.path, replacementRoute);
            if (!candidateRoute?.containsRequiredBase) {
                continue;
            }

            if (!bestRoute || compareTraceRoutes(candidateRoute, bestRoute, sortMode, requiredBasePalId) < 0) {
                bestRoute = candidateRoute;
            }
        }
    }

    if (bestRoute) {
        return bestRoute;
    }

    const fallbackRoute = solveBestTraceRoute(targetCandidate, maxDepth, new Set(), sortMode, requiredBasePalId, true);
    return fallbackRoute?.containsRequiredBase ? fallbackRoute : null;
}

function getBestTraceCacheKey(targetId, maxDepth, sortMode, requiredBasePalId) {
    return `${targetId}::${maxDepth}::sort=${sortMode}::required=${requiredBasePalId ?? ""}`;
}

function solveTraceRouteSet(candidate, remainingDepth, ancestry, sortMode, isRoot = false, limit = TARGET_ROUTE_VARIANT_LIMIT) {
    if (!candidate || limit <= 0) {
        return [];
    }

    const cacheKey = getRouteSetCacheKey(candidate, remainingDepth, ancestry, sortMode, isRoot, limit);
    const cachedRoutes = state.routeSetCache.get(cacheKey);
    if (cachedRoutes) {
        return cachedRoutes;
    }

    let routes = [];

    if (ancestry.has(candidate.id)) {
        routes = [createLeafRoute(candidate, "cycle_stop", null)];
    } else if (isCommonCandidate(candidate)) {
        routes = [createLeafRoute(candidate, "common", null)];
    } else if (shouldTreatAsSelfPairBase(candidate)) {
        routes = [createLeafRoute(candidate, "self_pair_base", null)];
    } else if (remainingDepth <= 0) {
        routes = [createLeafRoute(candidate, "depth_limit", null)];
    } else {
        const nextAncestry = new Set(ancestry);
        nextAncestry.add(candidate.id);

        const pairCandidates = getOrderedBestTracePairs(candidate, sortMode)
            .slice(0, TARGET_ROUTE_PAIR_SCAN_LIMIT);

        for (const pair of pairCandidates) {
            const leftRoutes = solveTraceRouteSet(
                pair.parentA,
                remainingDepth - 1,
                nextAncestry,
                sortMode,
                false,
                TARGET_ROUTE_CHILD_VARIANT_LIMIT
            );
            const rightRoutes = solveTraceRouteSet(
                pair.parentB,
                remainingDepth - 1,
                nextAncestry,
                sortMode,
                false,
                TARGET_ROUTE_CHILD_VARIANT_LIMIT
            );

            if (leftRoutes.length === 0 || rightRoutes.length === 0) {
                continue;
            }

            for (const leftRoute of leftRoutes) {
                for (const rightRoute of rightRoutes) {
                    routes.push(createPairRoute(candidate, pair, leftRoute, rightRoute));
                }
            }
        }

        if (routes.length === 0) {
            routes = [createLeafRoute(candidate, "no_visible_parents", null)];
        }
    }

    const dedupedRoutes = dedupeTraceRouteSet(routes)
        .sort((left, right) => compareTraceRoutes(left, right, sortMode, null))
        .slice(0, limit);

    state.routeSetCache.set(cacheKey, dedupedRoutes);
    return dedupedRoutes;
}

function getRouteSetCacheKey(candidate, remainingDepth, ancestry, sortMode, isRoot, limit) {
    const ancestryKey = Array.from(ancestry).sort().join("|");
    return [
        candidate.id,
        remainingDepth,
        sortMode,
        isRoot ? "root" : "sub",
        `limit=${limit}`,
        ancestryKey
    ].join("::");
}

function dedupeTraceRouteSet(routes) {
    const routesByKey = new Map();
    for (const route of routes) {
        if (!route) {
            continue;
        }

        const existing = routesByKey.get(route.comparisonKey);
        if (!existing) {
            routesByKey.set(route.comparisonKey, route);
            continue;
        }

        if (route.metrics.maxDepth < existing.metrics.maxDepth ||
            route.metrics.stepCount < existing.metrics.stepCount) {
            routesByKey.set(route.comparisonKey, route);
        }
    }

    return Array.from(routesByKey.values());
}

function solveBestTraceRoute(candidate, remainingDepth, ancestry, sortMode, requiredBasePalId = null, isRoot = false) {
    const cacheKey = getBestRouteCacheKey(candidate, remainingDepth, ancestry, sortMode, requiredBasePalId, isRoot);
    const cachedRoute = state.bestRouteCache.get(cacheKey);
    if (cachedRoute !== undefined) {
        return cachedRoute;
    }

    let route = null;

    if (!candidate) {
        route = null;
    } else if (ancestry.has(candidate.id)) {
        route = createLeafRoute(candidate, "cycle_stop", requiredBasePalId);
    } else if (requiredBasePalId && candidate.id === requiredBasePalId) {
        route = createLeafRoute(candidate, "required_base", requiredBasePalId);
    } else if (!requiredBasePalId && isCommonCandidate(candidate)) {
        route = requiredBasePalId
            ? null
            : createLeafRoute(candidate, "common", requiredBasePalId);
    } else if (!requiredBasePalId && shouldTreatAsSelfPairBase(candidate)) {
        route = requiredBasePalId
            ? null
            : createLeafRoute(candidate, "self_pair_base", requiredBasePalId);
    } else if (remainingDepth <= 0) {
        route = requiredBasePalId
            ? null
            : createLeafRoute(candidate, "depth_limit", requiredBasePalId);
    } else {
        const nextAncestry = new Set(ancestry);
        nextAncestry.add(candidate.id);

        for (const pair of getOrderedBestTracePairs(candidate, sortMode)) {
            if (requiredBasePalId) {
                const pairRoute = buildRequiredBasePairRoute(candidate, pair, remainingDepth, nextAncestry, sortMode, requiredBasePalId);
                if (pairRoute) {
                    route = pairRoute;
                    break;
                }
                continue;
            }

            const leftRoute = solveBestTraceParent(pair.parentA, candidate, remainingDepth, nextAncestry, sortMode, null);
            const rightRoute = solveBestTraceParent(pair.parentB, candidate, remainingDepth, nextAncestry, sortMode, null);
            if (!leftRoute || !rightRoute) {
                continue;
            }

            route = createPairRoute(candidate, pair, leftRoute, rightRoute);
            break;
        }

        if (!route && !requiredBasePalId) {
            route = createLeafRoute(candidate, "no_visible_parents", requiredBasePalId);
        } else {
            route ??= null;
        }
    }

    state.bestRouteCache.set(cacheKey, route);
    return route;
}

function solveBestTraceParent(parent, child, remainingDepth, ancestry, sortMode, requiredBasePalId = null) {
    if (parent.id === child.id) {
        return createLeafRoute(parent, "same_pal", requiredBasePalId);
    }

    return solveBestTraceRoute(parent, remainingDepth - 1, ancestry, sortMode, requiredBasePalId, false);
}

function getBestRouteCacheKey(candidate, remainingDepth, ancestry, sortMode, requiredBasePalId, isRoot) {
    const ancestryKey = Array.from(ancestry).sort().join("|");
    return [
        candidate.id,
        remainingDepth,
        sortMode,
        requiredBasePalId ?? "",
        isRoot ? "root" : "sub",
        ancestryKey
    ].join("::");
}

function buildRequiredBasePairRoute(candidate, pair, remainingDepth, ancestry, sortMode, requiredBasePalId) {
    const routeOptions = [];

    const leftRequired = solveBestTraceParent(pair.parentA, candidate, remainingDepth, ancestry, sortMode, requiredBasePalId);
    if (leftRequired) {
        const rightAny = solveBestTraceParent(pair.parentB, candidate, remainingDepth, ancestry, sortMode, null);
        if (rightAny) {
            routeOptions.push(createPairRoute(candidate, pair, leftRequired, rightAny));
        }
    }

    const rightRequired = solveBestTraceParent(pair.parentB, candidate, remainingDepth, ancestry, sortMode, requiredBasePalId);
    if (rightRequired) {
        const leftAny = solveBestTraceParent(pair.parentA, candidate, remainingDepth, ancestry, sortMode, null);
        if (leftAny) {
            routeOptions.push(createPairRoute(candidate, pair, leftAny, rightRequired));
        }
    }

    if (routeOptions.length === 0) {
        return null;
    }

    return routeOptions.reduce((bestRoute, currentRoute) =>
        compareTraceRoutes(bestRoute, currentRoute, sortMode, requiredBasePalId) <= 0 ? bestRoute : currentRoute
    );
}

function routeContainsBasePal(route, requiredBasePalId) {
    if (!route || !requiredBasePalId) {
        return false;
    }

    if (route.type === "leaf") {
        return route.pal.id === requiredBasePalId &&
            route.stopReason !== "cycle_stop" &&
            route.stopReason !== "same_pal";
    }

    return routeContainsBasePal(route.left, requiredBasePalId) ||
        routeContainsBasePal(route.right, requiredBasePalId);
}

function cloneRouteMarkingRequiredBase(route, requiredBasePalId) {
    if (!route) {
        return null;
    }

    if (route.type === "leaf") {
        const stopReason = route.pal.id === requiredBasePalId &&
                route.stopReason !== "cycle_stop" &&
                route.stopReason !== "same_pal"
            ? "required_base"
            : route.stopReason;
        return createLeafRoute(route.pal, stopReason, requiredBasePalId);
    }

    return createPairRoute(
        route.child,
        route.pair,
        cloneRouteMarkingRequiredBase(route.left, requiredBasePalId),
        cloneRouteMarkingRequiredBase(route.right, requiredBasePalId)
    );
}

function collectRouteAnchorsForRequiredBase(route, maxDepth) {
    const anchors = [];

    function visit(node, path, depthFromRoot, ancestryIds) {
        if (!node) {
            return;
        }

        const candidate = node.type === "pair" ? node.child : node.pal;
        if (path.length > 0) {
            anchors.push({
                path,
                candidate,
                remainingDepth: maxDepth - depthFromRoot,
                ancestry: new Set(ancestryIds)
            });
        }

        if (node.type !== "pair") {
            return;
        }

        const nextAncestry = ancestryIds.concat(node.child.id);
        visit(node.left, path.concat("left"), depthFromRoot + 1, nextAncestry);
        visit(node.right, path.concat("right"), depthFromRoot + 1, nextAncestry);
    }

    visit(route, [], 0, []);

    anchors.sort((left, right) =>
        left.remainingDepth - right.remainingDepth ||
        right.path.length - left.path.length ||
        left.candidate.displayName.localeCompare(right.candidate.displayName) ||
        left.candidate.tribeName.localeCompare(right.candidate.tribeName)
    );

    return anchors;
}

function replaceRouteAtPath(route, path, replacement) {
    if (!route) {
        return null;
    }

    if (path.length === 0) {
        return replacement;
    }

    if (route.type !== "pair") {
        return route;
    }

    const [head, ...tail] = path;
    const nextLeft = head === "left"
        ? replaceRouteAtPath(route.left, tail, replacement)
        : route.left;
    const nextRight = head === "right"
        ? replaceRouteAtPath(route.right, tail, replacement)
        : route.right;

    return createPairRoute(route.child, route.pair, nextLeft, nextRight);
}

function shouldTreatAsSelfPairBase(candidate) {
    if (!Number.isFinite(candidate?.rarityValue) || candidate.rarityValue > SELF_PAIR_BASE_RARITY_MAX) {
        return false;
    }

    let lowestTotalRarity = Number.POSITIVE_INFINITY;
    let selfPairIsLowest = false;

    for (const pair of getValidDirectTracePairs(candidate)) {
        const totalRarity = buildPairSortMetrics(pair).totalRarity;
        if (totalRarity < lowestTotalRarity) {
            lowestTotalRarity = totalRarity;
            selfPairIsLowest = isSelfPairForCandidate(pair, candidate);
        } else if (totalRarity === lowestTotalRarity && isSelfPairForCandidate(pair, candidate)) {
            selfPairIsLowest = true;
        }
    }

    return selfPairIsLowest && Number.isFinite(lowestTotalRarity);
}

function getValidDirectTracePairs(candidate) {
    return state.pairsByChildId.get(candidate.id) ?? [];
}

function getOrderedBestTracePairs(candidate, sortMode) {
    const pairs = getValidDirectTracePairs(candidate).slice();
    if (sortMode === "generations") {
        pairs.sort(compareBestGenerationPairs);
        return pairs;
    }

    return pairs.sort(comparePairs);
}

function compareBestGenerationPairs(left, right) {
    const leftMetrics = buildBestGenerationPairMetrics(left);
    const rightMetrics = buildBestGenerationPairMetrics(right);

    return leftMetrics.unresolvedParents - rightMetrics.unresolvedParents ||
        leftMetrics.maxUnresolvedParent - rightMetrics.maxUnresolvedParent ||
        leftMetrics.totalRarity - rightMetrics.totalRarity ||
        leftMetrics.highestRarity - rightMetrics.highestRarity ||
        leftMetrics.firstParentName.localeCompare(rightMetrics.firstParentName) ||
        leftMetrics.secondParentName.localeCompare(rightMetrics.secondParentName) ||
        leftMetrics.firstParentId.localeCompare(rightMetrics.firstParentId) ||
        leftMetrics.secondParentId.localeCompare(rightMetrics.secondParentId);
}

function buildBestGenerationPairMetrics(pair) {
    const parentWeights = [
        buildBestGenerationParentWeight(pair.parentA),
        buildBestGenerationParentWeight(pair.parentB)
    ];
    const pairMetrics = buildPairSortMetrics(pair);

    return {
        unresolvedParents: parentWeights[0] + parentWeights[1],
        maxUnresolvedParent: Math.max(parentWeights[0], parentWeights[1]),
        totalRarity: pairMetrics.totalRarity,
        highestRarity: pairMetrics.highestRarity,
        firstParentName: pairMetrics.firstParentName,
        secondParentName: pairMetrics.secondParentName,
        firstParentId: pairMetrics.firstParentId,
        secondParentId: pairMetrics.secondParentId
    };
}

function buildBestGenerationParentWeight(parent) {
    if (isCommonCandidate(parent) || shouldTreatAsSelfPairBase(parent)) {
        return 0;
    }

    return 1;
}

function isSelfPairForCandidate(pair, candidate) {
    return pair.parentA.id === candidate.id && pair.parentB.id === candidate.id;
}

function createLeafRoute(candidate, stopReason, requiredBasePalId = null) {
    const isRequiredBaseMatch = isRequiredBaseLeaf(candidate, stopReason, requiredBasePalId);
    return {
        type: "leaf",
        pal: candidate,
        stopReason,
        metrics: buildLeafMetrics(candidate),
        containsRequiredBase: isRequiredBaseMatch,
        isRequiredBaseMatch,
        comparisonKey: `leaf:${candidate.id}:${stopReason}`,
        signature: `${candidate.id}:${stopReason}`
    };
}

function createPairRoute(child, pair, left, right) {
    return {
        type: "pair",
        child,
        pair,
        left,
        right,
        metrics: buildPairNodeMetrics(left.metrics, right.metrics),
        containsRequiredBase: Boolean(left.containsRequiredBase || right.containsRequiredBase),
        comparisonKey: `pair:${buildPairRouteSignature(child, pair)}:${left.comparisonKey}:${right.comparisonKey}`,
        signature: buildPairRouteSignature(child, pair)
    };
}

function isRequiredBaseLeaf(candidate, stopReason, requiredBasePalId) {
    if (!requiredBasePalId || !candidate || candidate.id !== requiredBasePalId) {
        return false;
    }

    return stopReason !== "cycle_stop" && stopReason !== "same_pal";
}

function compareTraceRoutes(left, right, sortMode, requiredBasePalId) {
    if (!left && !right) {
        return 0;
    }

    if (!left) {
        return 1;
    }

    if (!right) {
        return -1;
    }

    if (requiredBasePalId && left.containsRequiredBase !== right.containsRequiredBase) {
        return left.containsRequiredBase ? -1 : 1;
    }

    if (sortMode === "generations") {
        return left.metrics.maxDepth - right.metrics.maxDepth ||
            left.metrics.stepCount - right.metrics.stepCount ||
            left.metrics.totalLeafRarity - right.metrics.totalLeafRarity ||
            left.metrics.highestLeafRarity - right.metrics.highestLeafRarity ||
            left.metrics.lowestLeafRarity - right.metrics.lowestLeafRarity ||
            left.metrics.leafCount - right.metrics.leafCount ||
            left.comparisonKey.localeCompare(right.comparisonKey);
    }

    return left.metrics.totalLeafRarity - right.metrics.totalLeafRarity ||
        left.metrics.highestLeafRarity - right.metrics.highestLeafRarity ||
        left.metrics.lowestLeafRarity - right.metrics.lowestLeafRarity ||
        left.metrics.maxDepth - right.metrics.maxDepth ||
        left.metrics.stepCount - right.metrics.stepCount ||
        left.metrics.leafCount - right.metrics.leafCount ||
        left.comparisonKey.localeCompare(right.comparisonKey);
}

function buildPairRouteSignature(child, pair) {
    const parentDescriptors = [
        buildTopLevelParentDescriptor(pair.parentA, pair.parentAGenderRequirement),
        buildTopLevelParentDescriptor(pair.parentB, pair.parentBGenderRequirement)
    ].sort();

    return `${child.id}:${parentDescriptors.join("::")}`;
}

function buildLeafMetrics(candidate) {
    const comparableRarity = getComparableRarity(candidate.rarityValue);
    const isCommon = isCommonCandidate(candidate);

    return {
        maxDepth: 0,
        stepCount: 0,
        highestLeafRarity: comparableRarity,
        totalLeafRarity: comparableRarity,
        lowestLeafRarity: comparableRarity,
        leafCount: 1,
        commonLeafCount: isCommon ? 1 : 0
    };
}

function buildPairNodeMetrics(leftMetrics, rightMetrics) {
    return {
        maxDepth: 1 + Math.max(leftMetrics.maxDepth, rightMetrics.maxDepth),
        stepCount: 1 + leftMetrics.stepCount + rightMetrics.stepCount,
        highestLeafRarity: Math.max(leftMetrics.highestLeafRarity, rightMetrics.highestLeafRarity),
        totalLeafRarity: leftMetrics.totalLeafRarity + rightMetrics.totalLeafRarity,
        lowestLeafRarity: Math.min(leftMetrics.lowestLeafRarity, rightMetrics.lowestLeafRarity),
        leafCount: leftMetrics.leafCount + rightMetrics.leafCount,
        commonLeafCount: leftMetrics.commonLeafCount + rightMetrics.commonLeafCount
    };
}

function renderTraceResults(candidate, traceResult) {
    elements.tracePanel.hidden = false;
    elements.traceTitle.textContent = `Best route for ${candidate.displayName}`;
    setSectionCollapsed("trace", false);
    renderBestTraceResult(candidate, traceResult);
}

function renderBestTraceResult(candidate, traceResult) {
    const route = traceResult.route;
    const sortMode = traceResult.sortMode;
    const requiredBaseCandidate = traceResult.requiredBasePalId
        ? state.candidateById.get(traceResult.requiredBasePalId) ?? null
        : null;
    if (!route) {
        renderTraceEmptyState(requiredBaseCandidate
            ? `No best route was found for ${candidate.displayName} using ${requiredBaseCandidate.displayName} as a base within the current generation limit.`
            : `No best route was found for ${candidate.displayName} within the current generation limit.`);
        return;
    }

    const presentation = buildBestRoutePresentation(route, { requiredBasePalId: traceResult.requiredBasePalId });
    const statusParts = [
        `${presentation.stepEntries.length.toLocaleString()} breeding steps.`,
        `${presentation.totalBaseCount.toLocaleString()} total base pals across ${presentation.baseItems.length.toLocaleString()} unique pals.`,
        `Optimized by ${describeTraceSortMode(sortMode)}.`
    ];
    if (requiredBaseCandidate) {
        statusParts.push(`Uses required base ${requiredBaseCandidate.displayName}.`);
    }

    elements.traceStatus.textContent = statusParts.join(" ");

    disposeActiveDependencyView();

    const fragment = document.createDocumentFragment();
    fragment.appendChild(renderBestBaseSummary(presentation));

    if (presentation.stepEntries.length > 0) {
        fragment.appendChild(renderDependencyTree(presentation));
    } else {
        fragment.appendChild(renderBestRouteLeafState(route, presentation));
    }

    elements.traceList.replaceChildren(fragment);
    initializeActiveDependencyView();
}

function renderTraceEmptyState(message) {
    disposeActiveDependencyView();
    const empty = document.createElement("div");
    empty.className = "empty-message";
    empty.textContent = message;
    elements.traceList.replaceChildren(empty);
}

function buildBestRoutePresentation(route, options = {}) {
    const stepEntries = [];
    const stepNumbers = new Map();
    const stepNumbersBySignature = new Map();
    const pairCounts = new Map();
    const requiredBasePalId = options.requiredBasePalId ?? null;
    const requiredBaseCandidate = requiredBasePalId
        ? state.candidateById.get(requiredBasePalId) ?? null
        : null;
    let nextStepNumber = 1;

    function count(node) {
        if (!node || node.type !== "pair") {
            return;
        }

        pairCounts.set(node.signature, (pairCounts.get(node.signature) ?? 0) + 1);
        count(node.left);
        count(node.right);
    }

    function visit(node) {
        if (!node || node.type !== "pair") {
            return;
        }

        visit(node.left);
        visit(node.right);

        const stepNumber = nextStepNumber++;
        stepNumbers.set(node, stepNumber);
        stepEntries.push({ stepNumber, node });
        if (!stepNumbersBySignature.has(node.signature)) {
            stepNumbersBySignature.set(node.signature, stepNumber);
        }
    }

    count(route);
    visit(route);

    const baseItems = collectBestRouteBaseItems(route);
    const totalBaseCount = baseItems.reduce((sum, item) => sum + item.count, 0);

    return {
        route,
        stepEntries,
        stepNumbers,
        stepNumbersBySignature,
        pairCounts,
        baseItems,
        totalBaseCount,
        requiredBasePalId,
        requiredBaseCandidate
    };
}

function collectBestRouteBaseItems(route) {
    const itemsByPalId = new Map();

    function visit(node) {
        if (!node) {
            return;
        }

        if (node.type === "leaf") {
            const existing = itemsByPalId.get(node.pal.id);
            if (existing) {
                existing.count += 1;
                return;
            }

            itemsByPalId.set(node.pal.id, {
                pal: node.pal,
                stopReason: node.stopReason,
                count: 1
            });
            return;
        }

        visit(node.left);
        visit(node.right);
    }

    visit(route);

    return Array.from(itemsByPalId.values()).sort((left, right) =>
        getComparableRarity(left.pal.rarityValue) - getComparableRarity(right.pal.rarityValue) ||
        left.pal.displayName.localeCompare(right.pal.displayName) ||
        left.pal.tribeName.localeCompare(right.pal.tribeName)
    );
}

function renderBestBaseSummary(presentation) {
    const section = document.createElement("section");
    section.className = "best-base-summary";

    const header = document.createElement("div");
    header.className = "best-base-header";

    const titleWrap = document.createElement("div");
    const title = document.createElement("h3");
    title.className = "best-section-title";
    title.textContent = "Base Pals Needed";

    const subtitle = document.createElement("p");
    subtitle.className = "best-section-subtitle";
    subtitle.textContent = presentation.requiredBaseCandidate
        ? `${presentation.totalBaseCount.toLocaleString()} total pals across ${presentation.baseItems.length.toLocaleString()} unique bases. Includes required base ${presentation.requiredBaseCandidate.displayName}.`
        : `${presentation.totalBaseCount.toLocaleString()} total pals across ${presentation.baseItems.length.toLocaleString()} unique bases`;

    titleWrap.append(title, subtitle);

    const metrics = document.createElement("div");
    metrics.className = "trace-route-metrics";
    metrics.append(
        createMetricBadge(`${presentation.totalBaseCount} total`),
        createMetricBadge(`${presentation.baseItems.length} unique`)
    );
    if (presentation.requiredBaseCandidate) {
        metrics.appendChild(createBadge(`Required: ${presentation.requiredBaseCandidate.displayName}`, "badge badge-required"));
    }

    header.append(titleWrap, metrics);

    const grid = document.createElement("div");
    grid.className = "best-base-grid";
    presentation.baseItems.forEach((item) => grid.appendChild(renderBestBaseItem(item, presentation)));

    section.append(header, grid);
    return section;
}

function renderBestBaseItem(item, presentation) {
    const article = document.createElement("article");
    article.className = "best-base-item";
    const isRequiredBase = presentation.requiredBasePalId === item.pal.id;
    if (isRequiredBase) {
        article.classList.add("best-base-item-required");
    }

    const count = document.createElement("div");
    count.className = "best-base-count";
    count.textContent = String(item.count);

    const body = document.createElement("div");
    body.className = "best-base-body";

    const name = document.createElement("h4");
    name.className = "best-base-name";
    name.appendChild(createPalIdentity(item.pal, { variant: "base" }));

    const badges = document.createElement("div");
    badges.className = "best-base-badges";
    if (item.pal.rarity) {
        badges.appendChild(createBadge(
            formatRarity(item.pal.rarity),
            `badge badge-rarity ${item.pal.rarity.className}`));
    }

    const stopLabel = formatStopReason(item.stopReason);
    if (stopLabel) {
        badges.appendChild(createBadge(stopLabel, "badge badge-stop"));
    }
    if (isRequiredBase) {
        badges.appendChild(createBadge("Required", "badge badge-required"));
    }

    body.append(name, badges);
    article.append(count, body);
    return article;
}

function renderDependencyTree(presentation) {
    return renderDependencyGraphScene(presentation);
}

function renderDependencyNode(node, presentation, renderedSignatures, options = {}) {
    if (!node) {
        return document.createDocumentFragment();
    }

    if (node.type !== "pair") {
        return renderDependencyLeaf(node);
    }

    const repeatedCount = presentation.pairCounts.get(node.signature) ?? 0;
    const canonicalStepNumber = presentation.stepNumbersBySignature.get(node.signature) ?? presentation.stepNumbers.get(node);
    if (!options.isRoot && repeatedCount > 1 && renderedSignatures.has(node.signature)) {
        return renderDependencyReference(node, canonicalStepNumber);
    }

    renderedSignatures.add(node.signature);

    const article = document.createElement("article");
    article.className = "best-step dependency-step";
    if (node.pair.rule === "unique_combo") {
        article.classList.add("best-step-unique");
    }
    if (options.isRoot) {
        article.classList.add("dependency-step-root");
    }
    if (canonicalStepNumber) {
        article.id = `dependency-step-${canonicalStepNumber}`;
        article.dataset.stepNumber = String(canonicalStepNumber);
    }

    const header = document.createElement("div");
    header.className = "best-step-header";

    const titleWrap = document.createElement("div");

    const stepIndex = document.createElement("span");
    stepIndex.className = "best-step-index";
    stepIndex.textContent = `Step ${canonicalStepNumber}`;

    const title = document.createElement("h4");
    title.className = "best-step-title";
    title.appendChild(createPalIdentity(node.child, { variant: "step" }));

    const subtitle = document.createElement("p");
    subtitle.className = "best-step-subtitle";
    subtitle.textContent = options.isRoot
        ? `Target result. Breed ${node.child.displayName} from these parents.`
        : `Breed ${node.child.displayName} from these parents.`;

    titleWrap.append(stepIndex, title, subtitle);

    const badges = document.createElement("div");
    badges.className = "trace-node-badges";
    if (node.child.rarity) {
        badges.appendChild(createBadge(
            formatRarity(node.child.rarity),
            `badge badge-rarity ${node.child.rarity.className}`));
    }
    if (node.pair.rule === "unique_combo") {
        badges.appendChild(createBadge("Unique", "badge badge-unique"));
    }

    header.append(titleWrap, badges);

    const recipe = document.createElement("div");
    recipe.className = "best-step-recipe";
    recipe.append(
        renderBestIngredientBlock("Parent A", node.pair.parentA, node.pair.parentAGenderRequirement, node.left, presentation.stepNumbersBySignature),
        renderBestStepOperator(),
        renderBestIngredientBlock("Parent B", node.pair.parentB, node.pair.parentBGenderRequirement, node.right, presentation.stepNumbersBySignature)
    );

    const children = document.createElement("div");
    children.className = "dependency-children";
    children.append(
        renderDependencyBranch("Parent A chain", node.left, presentation, renderedSignatures),
        renderDependencyBranch("Parent B chain", node.right, presentation, renderedSignatures)
    );

    article.append(header, recipe, children);
    return article;
}

function renderDependencyBranch(label, sourceNode, presentation, renderedSignatures) {
    const branch = document.createElement("div");
    branch.className = "dependency-branch";

    const branchLabel = document.createElement("span");
    branchLabel.className = "dependency-branch-label";
    branchLabel.textContent = label;

    branch.append(branchLabel, renderDependencyNode(sourceNode, presentation, renderedSignatures));
    return branch;
}

function renderDependencyLeaf(node) {
    const article = document.createElement("article");
    article.className = "dependency-leaf";

    const header = document.createElement("div");
    header.className = "dependency-leaf-header";

    const title = document.createElement("h5");
    title.className = "best-parent-name dependency-leaf-title";
    title.appendChild(createPalIdentity(node.pal, { variant: "parent" }));

    const badges = document.createElement("div");
    badges.className = "best-parent-badges";
    if (node.pal.rarity) {
        badges.appendChild(createBadge(
            formatRarity(node.pal.rarity),
            `badge badge-rarity ${node.pal.rarity.className}`));
    }

    const stopLabel = formatStopReason(node.stopReason);
    if (stopLabel) {
        badges.appendChild(createBadge(stopLabel, "badge badge-stop"));
    }

    header.append(title, badges);

    const copy = document.createElement("p");
    copy.className = "dependency-leaf-copy";
    copy.textContent = describeLeafStop(node.stopReason) || describeBestIngredientSource(node, null) || "Use as base.";
    copy.hidden = !copy.textContent;

    article.append(header);
    if (copy.textContent) {
        article.append(copy);
    }

    return article;
}

function renderDependencyReference(node, stepNumber) {
    const article = document.createElement("article");
    article.className = "dependency-ref";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "dependency-ref-button";
    button.dataset.stepRef = String(stepNumber);

    const titleWrap = document.createElement("div");

    const kicker = document.createElement("span");
    kicker.className = "dependency-ref-kicker";
    kicker.textContent = `See Step ${stepNumber}`;

    const title = document.createElement("h5");
    title.className = "best-parent-name dependency-ref-title";
    title.appendChild(createPalIdentity(node.child, { variant: "parent" }));

    titleWrap.append(kicker, title);

    const badges = document.createElement("div");
    badges.className = "best-parent-badges";
    if (node.pair.parentAGenderRequirement || node.pair.parentBGenderRequirement) {
        badges.appendChild(createBadge("Reused", "badge badge-metric"));
    } else {
        badges.appendChild(createBadge("Step Ref", "badge badge-metric"));
    }

    button.append(titleWrap, badges);
    article.append(button);
    return article;
}

function renderDependencyGraphScene(presentation) {
    const layout = buildDependencyGraphLayoutScene(presentation);
    const section = document.createElement("section");
    section.className = "dependency-tree dependency-tree-graph";
    section.dataset.dependencyTree = "true";
    section._dependencyLayout = layout;

    const header = document.createElement("div");
    header.className = "dependency-tree-header";

    const copyWrap = document.createElement("div");
    copyWrap.className = "dependency-tree-copy";

    const title = document.createElement("h3");
    title.className = "best-section-title";
    title.textContent = "Dependency Tree";

    const subtitle = document.createElement("p");
    subtitle.className = "best-section-subtitle";
    subtitle.textContent = "Base pals are on the left. Drag to pan, use the wheel to zoom, or use the controls to inspect each branch.";

    copyWrap.append(title, subtitle);

    const toolbar = document.createElement("div");
    toolbar.className = "dependency-toolbar";

    const hint = document.createElement("p");
    hint.className = "dependency-toolbar-hint";
    hint.textContent = "Target result is on the right. Reused branches jump back to their original step.";

    const toolbarControls = document.createElement("div");
    toolbarControls.className = "dependency-toolbar-controls";

    const scaleReadout = document.createElement("output");
    scaleReadout.className = "dependency-scale-readout";
    scaleReadout.dataset.dependencyScaleLabel = "true";
    scaleReadout.textContent = "100%";

    toolbarControls.append(
        scaleReadout,
        createDependencyGraphToolbarButton("-", "zoom-out", "Zoom out"),
        createDependencyGraphToolbarButton("+", "zoom-in", "Zoom in"),
        createDependencyGraphToolbarButton("Fit", "fit", "Fit the full tree"),
        createDependencyGraphToolbarButton("100%", "reset", "Reset zoom")
    );
    toolbar.append(hint, toolbarControls);

    header.append(copyWrap, toolbar);

    const viewportShell = document.createElement("div");
    viewportShell.className = "dependency-viewport-shell";

    const viewport = document.createElement("div");
    viewport.className = "dependency-viewport";
    viewport.dataset.dependencyViewport = "true";
    viewport.setAttribute("aria-label", "Breeding dependency tree viewport");

    const scene = document.createElement("div");
    scene.className = "dependency-scene";
    scene.dataset.dependencyScene = "true";
    scene.style.width = `${layout.width}px`;
    scene.style.height = `${layout.height}px`;

    const edgeLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    edgeLayer.classList.add("dependency-edges");
    edgeLayer.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
    edgeLayer.setAttribute("width", String(layout.width));
    edgeLayer.setAttribute("height", String(layout.height));
    layout.edges.forEach((edge) => edgeLayer.appendChild(renderDependencyGraphEdge(edge, layout.nodesById)));

    const nodeLayer = document.createElement("div");
    nodeLayer.className = "dependency-node-layer";
    layout.nodes.forEach((node) => nodeLayer.appendChild(renderDependencyGraphNodeCard(node, presentation)));

    scene.append(edgeLayer, nodeLayer);
    viewport.appendChild(scene);
    viewportShell.appendChild(viewport);
    section.append(header, viewportShell);

    return section;
}

function createDependencyGraphToolbarButton(label, action, title) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dependency-toolbutton";
    button.dataset.dependencyAction = action;
    button.textContent = label;
    button.setAttribute("aria-label", title);
    button.title = title;
    return button;
}

function buildDependencyGraphLayoutScene(presentation) {
    let nextId = 1;
    const renderedSignatures = new Set();

    function buildDisplayNode(routeNode, options = {}) {
        if (!routeNode) {
            return null;
        }

        if (routeNode.type !== "pair") {
            const dimensions = getDependencyGraphNodeDimensions("leaf");
            return {
                id: `dependency-node-${nextId++}`,
                kind: "leaf",
                routeNode,
                width: dimensions.width,
                height: dimensions.height,
                level: 0,
                subtreeHeight: dimensions.height,
                stepNumber: null,
                isRoot: false
            };
        }

        const repeatedCount = presentation.pairCounts.get(routeNode.signature) ?? 0;
        const stepNumber = presentation.stepNumbersBySignature.get(routeNode.signature) ?? presentation.stepNumbers.get(routeNode) ?? null;
        if (!options.isRoot && repeatedCount > 1 && renderedSignatures.has(routeNode.signature)) {
            const dimensions = getDependencyGraphNodeDimensions("ref");
            return {
                id: `dependency-node-${nextId++}`,
                kind: "ref",
                routeNode,
                width: dimensions.width,
                height: dimensions.height,
                level: 0,
                subtreeHeight: dimensions.height,
                stepNumber,
                isRoot: false
            };
        }

        renderedSignatures.add(routeNode.signature);

        const leftNode = buildDisplayNode(routeNode.left);
        const rightNode = buildDisplayNode(routeNode.right);
        const dimensions = getDependencyGraphNodeDimensions("pair");
        const combinedChildrenHeight = leftNode.subtreeHeight + rightNode.subtreeHeight + DEPENDENCY_GRAPH_LAYOUT.rowGap;

        return {
            id: `dependency-node-${nextId++}`,
            kind: "pair",
            routeNode,
            width: dimensions.width,
            height: dimensions.height,
            level: 1 + Math.max(leftNode.level, rightNode.level),
            subtreeHeight: Math.max(dimensions.height, combinedChildrenHeight),
            stepNumber,
            isRoot: Boolean(options.isRoot),
            children: [leftNode, rightNode]
        };
    }

    function positionDisplayNode(node, top, nodes, edges) {
        if (!node) {
            return;
        }

        if (node.kind === "pair") {
            const [leftNode, rightNode] = node.children;
            const childrenHeight = leftNode.subtreeHeight + rightNode.subtreeHeight + DEPENDENCY_GRAPH_LAYOUT.rowGap;
            const childrenTop = top + Math.max(0, (node.subtreeHeight - childrenHeight) / 2);

            positionDisplayNode(leftNode, childrenTop, nodes, edges);
            positionDisplayNode(rightNode, childrenTop + leftNode.subtreeHeight + DEPENDENCY_GRAPH_LAYOUT.rowGap, nodes, edges);

            edges.push(
                { id: `${node.id}-edge-a`, from: leftNode.id, to: node.id, slot: "a" },
                { id: `${node.id}-edge-b`, from: rightNode.id, to: node.id, slot: "b" }
            );
        }

        node.x = DEPENDENCY_GRAPH_LAYOUT.paddingX + (node.level * DEPENDENCY_GRAPH_LAYOUT.columnSpan);
        node.y = top + ((node.subtreeHeight - node.height) / 2);
        nodes.push(node);
    }

    const root = buildDisplayNode(presentation.route, { isRoot: true });
    const nodes = [];
    const edges = [];
    positionDisplayNode(root, DEPENDENCY_GRAPH_LAYOUT.paddingY, nodes, edges);

    const maxNodeWidth = nodes.reduce((widest, node) => Math.max(widest, node.width), DEPENDENCY_GRAPH_LAYOUT.pairWidth);
    const width = (DEPENDENCY_GRAPH_LAYOUT.paddingX * 2) + (root.level * DEPENDENCY_GRAPH_LAYOUT.columnSpan) + maxNodeWidth;
    const height = (DEPENDENCY_GRAPH_LAYOUT.paddingY * 2) + root.subtreeHeight;

    return {
        root,
        nodes,
        edges,
        nodesById: new Map(nodes.map((node) => [node.id, node])),
        width,
        height
    };
}

function getDependencyGraphNodeDimensions(kind) {
    switch (kind) {
        case "pair":
            return {
                width: DEPENDENCY_GRAPH_LAYOUT.pairWidth,
                height: DEPENDENCY_GRAPH_LAYOUT.pairHeight
            };
        case "ref":
            return {
                width: DEPENDENCY_GRAPH_LAYOUT.refWidth,
                height: DEPENDENCY_GRAPH_LAYOUT.refHeight
            };
        default:
            return {
                width: DEPENDENCY_GRAPH_LAYOUT.leafWidth,
                height: DEPENDENCY_GRAPH_LAYOUT.leafHeight
            };
    }
}

function renderDependencyGraphNodeCard(node, presentation) {
    if (node.kind === "pair") {
        return renderDependencyGraphPairNode(node, presentation);
    }

    if (node.kind === "ref") {
        return renderDependencyGraphReferenceNode(node);
    }

    return renderDependencyGraphLeafNode(node);
}

function renderDependencyGraphPairNode(node, presentation) {
    const article = document.createElement("article");
    article.className = "dependency-card dependency-card-pair";
    if (node.routeNode.pair.rule === "unique_combo") {
        article.classList.add("dependency-card-unique");
    }
    if (node.isRoot) {
        article.classList.add("dependency-card-root");
    }
    if (presentation.requiredBasePalId && node.routeNode.containsRequiredBase) {
        article.classList.add("dependency-card-on-required-path");
    }
    article.id = `dependency-step-${node.stepNumber}`;
    article.dataset.stepNumber = String(node.stepNumber);
    applyDependencyGraphNodePosition(article, node);

    const header = document.createElement("div");
    header.className = "dependency-card-header";

    const stepIndex = document.createElement("span");
    stepIndex.className = "best-step-index";
    stepIndex.textContent = `Step ${node.stepNumber}`;

    const badges = document.createElement("div");
    badges.className = "dependency-card-badges";
    if (node.routeNode.child.rarity) {
        badges.appendChild(createBadge(
            formatRarity(node.routeNode.child.rarity),
            `badge badge-rarity ${node.routeNode.child.rarity.className}`));
    }
    if (node.routeNode.pair.rule === "unique_combo") {
        badges.appendChild(createBadge("Unique", "badge badge-unique"));
    }
    if (node.isRoot) {
        badges.appendChild(createBadge("Target", "badge badge-metric"));
    }

    const title = document.createElement("h4");
    title.className = "dependency-card-title";
    title.appendChild(createPalIdentity(node.routeNode.child, { variant: "step", link: false }));

    const copy = document.createElement("p");
    copy.className = "dependency-card-copy";
    copy.textContent = node.isRoot
        ? `Final result. Breed ${node.routeNode.child.displayName} from these parents.`
        : `Breed ${node.routeNode.child.displayName} from these parents.`;

    const slots = document.createElement("div");
    slots.className = "dependency-parent-slots";
    slots.append(
        renderDependencyGraphParentSlot("Parent A", node.routeNode.pair.parentA, node.routeNode.pair.parentAGenderRequirement, node.routeNode.left, presentation.stepNumbersBySignature),
        renderDependencyGraphParentSlot("Parent B", node.routeNode.pair.parentB, node.routeNode.pair.parentBGenderRequirement, node.routeNode.right, presentation.stepNumbersBySignature)
    );

    header.append(stepIndex, badges);
    article.append(header, title, copy, slots);
    return article;
}

function renderDependencyGraphParentSlot(label, parent, genderRequirement, sourceNode, stepNumbers) {
    const slot = document.createElement("div");
    slot.className = "dependency-parent-slot";
    slot.classList.add(label === "Parent A" ? "dependency-parent-slot-a" : "dependency-parent-slot-b");

    const slotHeader = document.createElement("div");
    slotHeader.className = "dependency-parent-slot-header";

    const kicker = document.createElement("span");
    kicker.className = "dependency-parent-slot-label";
    kicker.textContent = label;

    const source = document.createElement("span");
    source.className = "dependency-parent-slot-source";
    source.textContent = buildDependencyGraphSourceLabel(sourceNode, stepNumbers);

    const title = document.createElement("h5");
    title.className = "dependency-parent-slot-title";
    title.appendChild(createPalIdentity(parent, { variant: "parent", link: false }));

    slotHeader.append(kicker, source);
    slot.append(slotHeader, title);

    if (genderRequirement) {
        const badges = document.createElement("div");
        badges.className = "dependency-parent-slot-badges";
        badges.appendChild(createBadge(genderRequirement, "badge badge-gender"));
        slot.appendChild(badges);
    }

    return slot;
}

function renderDependencyGraphLeafNode(node) {
    const article = document.createElement("article");
    article.className = "dependency-card dependency-card-leaf";
    if (node.routeNode.isRequiredBaseMatch) {
        article.classList.add("dependency-card-required");
    }
    applyDependencyGraphNodePosition(article, node);

    const header = document.createElement("div");
    header.className = "dependency-card-header";

    const title = document.createElement("h5");
    title.className = "dependency-card-title dependency-card-title-leaf";
    title.appendChild(createPalIdentity(node.routeNode.pal, { variant: "parent", link: false }));

    const badges = document.createElement("div");
    badges.className = "dependency-card-badges";
    if (node.routeNode.pal.rarity) {
        badges.appendChild(createBadge(
            formatRarity(node.routeNode.pal.rarity),
            `badge badge-rarity ${node.routeNode.pal.rarity.className}`));
    }

    const stopLabel = formatStopReason(node.routeNode.stopReason);
    if (stopLabel) {
        badges.appendChild(createBadge(stopLabel, "badge badge-stop"));
    }
    if (node.routeNode.isRequiredBaseMatch) {
        badges.appendChild(createBadge("Required", "badge badge-required"));
    }

    const copy = document.createElement("p");
    copy.className = "dependency-card-copy";
    copy.textContent = describeBestIngredientSource(node.routeNode, null) || describeLeafStop(node.routeNode.stopReason) || "Use as base.";

    header.append(title, badges);
    article.append(header, copy);
    return article;
}

function renderDependencyGraphReferenceNode(node) {
    const article = document.createElement("article");
    article.className = "dependency-card dependency-card-ref";
    applyDependencyGraphNodePosition(article, node);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "dependency-ref-button";
    button.dataset.stepRef = String(node.stepNumber);

    const kicker = document.createElement("span");
    kicker.className = "dependency-ref-kicker";
    kicker.textContent = `See Step ${node.stepNumber}`;

    const title = document.createElement("h5");
    title.className = "dependency-card-title dependency-card-title-ref";
    title.appendChild(createPalIdentity(node.routeNode.child, { variant: "parent", link: false }));

    const copy = document.createElement("p");
    copy.className = "dependency-card-copy dependency-card-copy-ref";
    copy.textContent = "Reused branch. Center the original step in the graph.";

    button.append(kicker, title, copy);
    article.appendChild(button);
    return article;
}

function applyDependencyGraphNodePosition(nodeElement, node) {
    nodeElement.style.left = `${node.x}px`;
    nodeElement.style.top = `${node.y}px`;
    nodeElement.style.width = `${node.width}px`;
    nodeElement.style.height = `${node.height}px`;
}

function buildDependencyGraphSourceLabel(sourceNode, stepNumbers) {
    if (!sourceNode) {
        return "";
    }

    if (sourceNode.type === "leaf" && sourceNode.isRequiredBaseMatch) {
        return "Required Base";
    }

    if (sourceNode.type === "pair") {
        const stepNumber = getStepNumberForRouteNode(sourceNode, stepNumbers);
        return stepNumber ? `Step ${stepNumber}` : "Step";
    }

    switch (sourceNode.stopReason) {
        case "common":
        case "self_pair_base":
        case "same_pal":
            return "Base";
        case "depth_limit":
            return "Depth Limit";
        case "no_visible_parents":
            return "No Parents";
        case "cycle_stop":
            return "Cycle Stop";
        default:
            return "Base";
    }
}

function renderDependencyGraphEdge(edge, nodesById) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", `dependency-edge dependency-edge-${edge.slot}`);
    path.setAttribute("d", buildDependencyGraphEdgePath(edge, nodesById));
    return path;
}

function buildDependencyGraphEdgePath(edge, nodesById) {
    const fromNode = nodesById.get(edge.from);
    const toNode = nodesById.get(edge.to);
    if (!fromNode || !toNode) {
        return "";
    }

    const start = getDependencyGraphOutputAnchor(fromNode);
    const end = getDependencyGraphInputAnchor(toNode, edge.slot);
    const controlDistance = Math.max(42, (end.x - start.x) * 0.42);
    const controlStartX = start.x + controlDistance;
    const controlEndX = end.x - controlDistance;

    return `M ${start.x} ${start.y} C ${controlStartX} ${start.y}, ${controlEndX} ${end.y}, ${end.x} ${end.y}`;
}

function getDependencyGraphOutputAnchor(node) {
    switch (node.kind) {
        case "pair":
            return {
                x: node.x + node.width,
                y: node.y + DEPENDENCY_GRAPH_LAYOUT.pairOutputOffsetY
            };
        case "ref":
            return {
                x: node.x + node.width,
                y: node.y + DEPENDENCY_GRAPH_LAYOUT.refOutputOffsetY
            };
        default:
            return {
                x: node.x + node.width,
                y: node.y + DEPENDENCY_GRAPH_LAYOUT.leafOutputOffsetY
            };
    }
}

function getDependencyGraphInputAnchor(node, slot) {
    if (node.kind !== "pair") {
        return {
            x: node.x,
            y: node.y + (node.height / 2)
        };
    }

    return {
        x: node.x,
        y: node.y + (slot === "a"
            ? DEPENDENCY_GRAPH_LAYOUT.pairInputOffsetAY
            : DEPENDENCY_GRAPH_LAYOUT.pairInputOffsetBY)
    };
}

function initializeActiveDependencyView() {
    const section = elements.traceList.querySelector("[data-dependency-tree]");
    if (!section) {
        return;
    }

    const viewport = section.querySelector("[data-dependency-viewport]");
    const scene = section.querySelector("[data-dependency-scene]");
    const scaleLabel = section.querySelector("[data-dependency-scale-label]");
    const layout = section._dependencyLayout;
    if (!viewport || !scene || !scaleLabel || !layout) {
        return;
    }

    const view = {
        section,
        viewport,
        scene,
        scaleLabel,
        layout,
        width: layout.width,
        height: layout.height,
        scale: 1,
        fitScale: 1,
        x: 0,
        y: 0,
        pointerId: null,
        dragOriginX: 0,
        dragOriginY: 0,
        startX: 0,
        startY: 0,
        nodesByStep: new Map(
            layout.nodes
                .filter((node) => Number.isFinite(node.stepNumber))
                .map((node) => [String(node.stepNumber), node])
        )
    };

    const onPointerDown = (event) => {
        if (event.button !== 0 || event.target.closest(".dependency-ref-button, .pal-link")) {
            return;
        }

        view.pointerId = event.pointerId;
        view.dragOriginX = event.clientX;
        view.dragOriginY = event.clientY;
        view.startX = view.x;
        view.startY = view.y;
        view.viewport.classList.add("is-dragging");
        view.viewport.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event) => {
        if (view.pointerId !== event.pointerId) {
            return;
        }

        view.x = view.startX + (event.clientX - view.dragOriginX);
        view.y = view.startY + (event.clientY - view.dragOriginY);
        constrainDependencyGraphView(view);
        applyDependencyGraphViewTransform(view);
    };

    const stopDragging = () => {
        view.pointerId = null;
        view.viewport.classList.remove("is-dragging");
    };

    const onPointerUp = (event) => {
        if (view.pointerId !== event.pointerId) {
            return;
        }

        view.viewport.releasePointerCapture(event.pointerId);
        stopDragging();
    };

    const onPointerCancel = (event) => {
        if (view.pointerId !== event.pointerId) {
            return;
        }

        stopDragging();
    };

    const onWheel = (event) => {
        event.preventDefault();
        const zoomFactor = event.deltaY < 0
            ? DEPENDENCY_GRAPH_LAYOUT.zoomStep
            : (1 / DEPENDENCY_GRAPH_LAYOUT.zoomStep);
        zoomDependencyGraphViewAtPoint(view, view.scale * zoomFactor, event.clientX, event.clientY);
    };

    const onToolbarClick = (event) => {
        const actionButton = event.target.closest("[data-dependency-action]");
        if (!actionButton) {
            return;
        }

        const action = actionButton.dataset.dependencyAction;
        if (action === "fit") {
            fitDependencyGraphView(view);
            return;
        }

        if (action === "reset") {
            centerDependencyGraphScene(view, 1);
            return;
        }

        const viewportRect = view.viewport.getBoundingClientRect();
        const centerX = viewportRect.left + (viewportRect.width / 2);
        const centerY = viewportRect.top + (viewportRect.height / 2);
        const nextScale = action === "zoom-in"
            ? view.scale * DEPENDENCY_GRAPH_LAYOUT.zoomStep
            : view.scale / DEPENDENCY_GRAPH_LAYOUT.zoomStep;
        zoomDependencyGraphViewAtPoint(view, nextScale, centerX, centerY);
    };

    viewport.addEventListener("pointerdown", onPointerDown);
    viewport.addEventListener("pointermove", onPointerMove);
    viewport.addEventListener("pointerup", onPointerUp);
    viewport.addEventListener("pointercancel", onPointerCancel);
    viewport.addEventListener("wheel", onWheel, { passive: false });
    section.addEventListener("click", onToolbarClick);

    view.destroy = () => {
        viewport.removeEventListener("pointerdown", onPointerDown);
        viewport.removeEventListener("pointermove", onPointerMove);
        viewport.removeEventListener("pointerup", onPointerUp);
        viewport.removeEventListener("pointercancel", onPointerCancel);
        viewport.removeEventListener("wheel", onWheel);
        section.removeEventListener("click", onToolbarClick);
    };

    state.activeDependencyView = view;
    window.requestAnimationFrame(() => fitDependencyGraphView(view));
}

function disposeActiveDependencyView() {
    if (!state.activeDependencyView) {
        return;
    }

    state.activeDependencyView.destroy?.();
    state.activeDependencyView = null;
}

function fitDependencyGraphView(view) {
    if (!view) {
        return;
    }

    const viewportWidth = view.viewport.clientWidth;
    const viewportHeight = view.viewport.clientHeight;
    if (!viewportWidth || !viewportHeight) {
        return;
    }

    const fitScale = Math.min(
        (viewportWidth - (DEPENDENCY_GRAPH_LAYOUT.panMargin * 2)) / view.width,
        (viewportHeight - (DEPENDENCY_GRAPH_LAYOUT.panMargin * 2)) / view.height,
        1
    );
    view.fitScale = clampDependencyGraphScale(fitScale);
    centerDependencyGraphScene(view, view.fitScale);
}

function centerDependencyGraphScene(view, nextScale) {
    view.scale = clampDependencyGraphScale(nextScale);
    view.x = (view.viewport.clientWidth - (view.width * view.scale)) / 2;
    view.y = (view.viewport.clientHeight - (view.height * view.scale)) / 2;
    constrainDependencyGraphView(view);
    applyDependencyGraphViewTransform(view);
}

function zoomDependencyGraphViewAtPoint(view, nextScale, clientX, clientY) {
    const clampedScale = clampDependencyGraphScale(nextScale);
    const viewportRect = view.viewport.getBoundingClientRect();
    const offsetX = clientX - viewportRect.left;
    const offsetY = clientY - viewportRect.top;
    const sceneX = (offsetX - view.x) / view.scale;
    const sceneY = (offsetY - view.y) / view.scale;

    view.scale = clampedScale;
    view.x = offsetX - (sceneX * view.scale);
    view.y = offsetY - (sceneY * view.scale);
    constrainDependencyGraphView(view);
    applyDependencyGraphViewTransform(view);
}

function constrainDependencyGraphView(view) {
    const viewportWidth = view.viewport.clientWidth;
    const viewportHeight = view.viewport.clientHeight;
    const scaledWidth = view.width * view.scale;
    const scaledHeight = view.height * view.scale;
    const margin = DEPENDENCY_GRAPH_LAYOUT.panMargin;

    if (scaledWidth <= viewportWidth - (margin * 2)) {
        view.x = (viewportWidth - scaledWidth) / 2;
    } else {
        const minX = viewportWidth - scaledWidth - margin;
        const maxX = margin;
        view.x = Math.min(maxX, Math.max(minX, view.x));
    }

    if (scaledHeight <= viewportHeight - (margin * 2)) {
        view.y = (viewportHeight - scaledHeight) / 2;
    } else {
        const minY = viewportHeight - scaledHeight - margin;
        const maxY = margin;
        view.y = Math.min(maxY, Math.max(minY, view.y));
    }
}

function applyDependencyGraphViewTransform(view) {
    view.scene.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    view.scaleLabel.textContent = `${Math.round(view.scale * 100)}%`;
}

function clampDependencyGraphScale(scale) {
    return Math.min(DEPENDENCY_GRAPH_LAYOUT.maxScale, Math.max(DEPENDENCY_GRAPH_LAYOUT.minScale, scale));
}

function focusDependencyStep(stepNumber) {
    const view = state.activeDependencyView;
    if (!view) {
        return;
    }

    const targetNode = view.nodesByStep.get(String(stepNumber));
    if (!targetNode) {
        return;
    }

    view.scale = clampDependencyGraphScale(Math.max(view.scale, Math.max(view.fitScale, 0.72)));
    view.x = (view.viewport.clientWidth / 2) - ((targetNode.x + (targetNode.width / 2)) * view.scale);
    view.y = (view.viewport.clientHeight / 2) - ((targetNode.y + (targetNode.height / 2)) * view.scale);
    constrainDependencyGraphView(view);
    applyDependencyGraphViewTransform(view);

    const target = view.section.querySelector(`#dependency-step-${stepNumber}`);
    if (!target) {
        return;
    }

    target.classList.remove("is-highlighted");
    void target.offsetWidth;
    target.classList.add("is-highlighted");

    window.clearTimeout(target._dependencyHighlightTimeout);
    target._dependencyHighlightTimeout = window.setTimeout(() => {
        target.classList.remove("is-highlighted");
    }, 1800);
}

function renderBestIngredientBlock(label, parent, genderRequirement, sourceNode, stepNumbers) {
    const block = document.createElement("div");
    block.className = "best-parent";

    const kicker = document.createElement("span");
    kicker.className = "best-parent-kicker";
    kicker.textContent = label;

    const name = document.createElement("h5");
    name.className = "best-parent-name";
    name.appendChild(createPalIdentity(parent, { variant: "parent" }));

    const badges = document.createElement("div");
    badges.className = "best-parent-badges";
    if (genderRequirement) {
        badges.appendChild(createBadge(genderRequirement, "badge badge-gender"));
    }
    if (parent.rarity) {
        badges.appendChild(createBadge(
            formatRarity(parent.rarity),
            `badge badge-rarity ${parent.rarity.className}`));
    }

    if (sourceNode.type === "pair") {
        const stepNumber = getStepNumberForRouteNode(sourceNode, stepNumbers);
        if (stepNumber) {
            badges.appendChild(createBadge(`Step ${stepNumber}`, "badge badge-metric"));
        }
    } else {
        const stopLabel = formatStopReason(sourceNode.stopReason);
        if (stopLabel) {
            badges.appendChild(createBadge(stopLabel, "badge badge-stop"));
        }
    }

    const source = document.createElement("p");
    source.className = "best-parent-source";
    source.textContent = describeBestIngredientSource(sourceNode, stepNumbers);
    source.hidden = !source.textContent;

    block.append(kicker, name, badges);
    if (source.textContent) {
        block.append(source);
    }

    return block;
}

function renderBestStepOperator() {
    const operator = document.createElement("div");
    operator.className = "best-step-operator";
    operator.textContent = "+";
    return operator;
}

function describeBestIngredientSource(node, stepNumbers) {
    if (node.type === "pair") {
        const stepNumber = getStepNumberForRouteNode(node, stepNumbers);
        return stepNumber ? `Make in Step ${stepNumber}` : "";
    }

    switch (node.stopReason) {
        case "required_base":
            return "Use as required base";
        case "common":
        case "self_pair_base":
            return "Use as base";
        case "depth_limit":
            return "Stops at current depth limit";
        case "no_visible_parents":
            return "No visible parents in current data";
        default:
            return "";
    }
}

function getStepNumberForRouteNode(node, stepNumbers) {
    if (!node || !stepNumbers) {
        return null;
    }

    return stepNumbers.get(node) ?? stepNumbers.get(node.signature) ?? null;
}

function renderBestRouteLeafState(route, presentation = null) {
    const article = document.createElement("article");
    article.className = "best-route-leaf";
    const isRequiredBase = Boolean(presentation?.requiredBasePalId && route.pal.id === presentation.requiredBasePalId && route.isRequiredBaseMatch);
    if (isRequiredBase) {
        article.classList.add("best-route-leaf-required");
    }

    const header = document.createElement("div");
    header.className = "best-step-header";

    const titleWrap = document.createElement("div");
    const title = document.createElement("h3");
    title.className = "best-section-title";
    title.appendChild(createPalIdentity(route.pal, { variant: "step" }));

    const subtitle = document.createElement("p");
    subtitle.className = "best-section-subtitle";
    subtitle.textContent = "No breeding steps are needed under the current rules.";

    titleWrap.append(title, subtitle);

    const badges = document.createElement("div");
    badges.className = "trace-node-badges";
    if (route.pal.rarity) {
        badges.appendChild(createBadge(
            formatRarity(route.pal.rarity),
            `badge badge-rarity ${route.pal.rarity.className}`));
    }
    const stopLabel = formatStopReason(route.stopReason);
    if (stopLabel) {
        badges.appendChild(createBadge(stopLabel, "badge badge-stop"));
    }
    if (isRequiredBase) {
        badges.appendChild(createBadge("Required", "badge badge-required"));
    }

    header.append(titleWrap, badges);
    article.append(header);
    return article;
}

function createMetricBadge(text) {
    return createBadge(text, "badge badge-metric");
}

function buildTopLevelParentDescriptor(parent, genderRequirement) {
    const gender = String(genderRequirement ?? "").trim().toLowerCase();
    return `${parent.id}:${gender}`;
}

function formatStopReason(stopReason) {
    switch (stopReason) {
        case "required_base":
            return "Required Base";
        case "common":
            return "Common";
        case "self_pair_base":
            return "Self-Pair Base";
        case "depth_limit":
            return "Depth Limit";
        case "same_pal":
            return "";
        case "cycle_stop":
            return "Cycle Stop";
        case "no_visible_parents":
            return "No Parents";
        default:
            return "Stop";
    }
}

function describeLeafStop(stopReason) {
    switch (stopReason) {
        case "required_base":
            return "Expansion stops here because this Pal is the required base.";
        case "common":
            return "Expansion stops here because this Pal is already in the Common bucket.";
        case "self_pair_base":
            return "";
        case "depth_limit":
            return "Expansion stopped at the current generation limit.";
        case "same_pal":
            return "";
        case "cycle_stop":
            return "";
        case "no_visible_parents":
            return "No visible parent pairs were found for this Pal in the current filtered dataset.";
        default:
            return "Expansion stopped for this route.";
    }
}

function describeTraceSortMode(sortMode) {
    return sortMode === "generations"
        ? "Fewest Generations"
        : "Lowest Total Rarity";
}

function readTraceMaxDepth() {
    const parsed = Number.parseInt(elements.traceMaxDepth.value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 4;
}

function isCommonCandidate(candidate) {
    return Number.isFinite(candidate?.rarityValue) && candidate.rarityValue <= COMMON_RARITY_MAX;
}

function getComparableRarity(rarityValue) {
    return Number.isFinite(rarityValue) ? rarityValue : 999;
}

function formatRarityValue(rarityValue) {
    if (!Number.isFinite(rarityValue) || rarityValue >= 999) {
        return "Unknown";
    }

    return formatRarity(describeRarity(rarityValue));
}

function renderResultCard(pair) {
    const card = elements.resultTemplate.content.firstElementChild.cloneNode(true);
    const parentBlocks = card.querySelectorAll(".parent-block");

    populateParentBlock(parentBlocks[0], pair.parentA, pair.parentAGenderRequirement);
    populateParentBlock(parentBlocks[1], pair.parentB, pair.parentBGenderRequirement);
    card.classList.toggle("result-card-unique", pair.rule === "unique_combo");

    return card;
}

function populateParentBlock(block, parent, genderRequirement) {
    const name = block.querySelector(".parent-name");
    name.replaceChildren(createPalIdentity(parent, { variant: "result" }));
    const meta = block.querySelector(".parent-meta");
    meta.hidden = true;
    meta.textContent = "";

    const badges = block.querySelector(".parent-badges");
    badges.replaceChildren();

    if (genderRequirement) {
        badges.appendChild(createBadge(genderRequirement, "badge badge-gender"));
    }

    if (parent.rarity) {
        badges.appendChild(createBadge(
            formatRarity(parent.rarity),
            `badge badge-rarity ${parent.rarity.className}`));
    }
}

function createBadge(text, className) {
    const badge = document.createElement("span");
    badge.className = className;
    badge.textContent = text;
    return badge;
}

function createPalIdentity(pal, options = {}) {
    const wrapper = document.createElement("span");
    const variant = String(options.variant ?? "result").trim() || "result";
    wrapper.className = `pal-identity pal-identity-${variant}`;

    const displayName = getPalDisplayName(pal);
    const label = options.link === false
        ? createPalTextLabel(displayName)
        : createPalLink(displayName);

    wrapper.append(
        createPalAvatar(pal, { loading: options.loading }),
        label
    );

    if (options.tooltip !== false && hasPalTooltipData(pal)) {
        wrapper.classList.add("pal-identity-has-tooltip");
        attachPalTooltip(wrapper, pal);
    }

    return wrapper;
}

function createPalAvatar(pal, options = {}) {
    const avatar = document.createElement("span");
    avatar.className = "pal-avatar";
    avatar.setAttribute("aria-hidden", "true");

    const fallback = document.createElement("span");
    fallback.className = "pal-avatar-fallback";
    fallback.textContent = buildPalAvatarLabel(pal);
    avatar.appendChild(fallback);

    const iconPath = String(pal?.iconPath ?? "").trim();
    if (!iconPath) {
        avatar.classList.add("is-fallback");
        return avatar;
    }

    const image = document.createElement("img");
    image.className = "pal-avatar-image";
    image.src = iconPath;
    image.alt = "";
    image.decoding = "async";
    image.loading = options.loading ?? "lazy";
    image.addEventListener("error", () => {
        avatar.classList.add("is-fallback");
        image.remove();
    }, { once: true });
    avatar.appendChild(image);

    return avatar;
}

function buildPalAvatarLabel(pal) {
    const displayName = getPalDisplayName(pal);
    const fallbackSource = `${displayName} ${String(pal?.tribeName ?? pal?.id ?? "").trim()}`.trim();
    const parts = fallbackSource.match(/[A-Za-z0-9]+/g) ?? [];

    if (parts.length >= 2) {
        return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }

    if (parts.length === 1) {
        return parts[0].slice(0, 2).toUpperCase();
    }

    return "?";
}

function getPalDisplayName(pal) {
    const displayName = String(pal?.displayName ?? "").trim();
    if (displayName) {
        return displayName;
    }

    const tribeName = String(pal?.tribeName ?? pal?.id ?? "").trim();
    return tribeName || "(unknown)";
}

function createPalTextLabel(displayName) {
    const label = document.createElement("span");
    label.className = "pal-identity-label";
    label.textContent = displayName;
    return label;
}

function createPalLink(displayName) {
    const link = document.createElement("a");
    link.className = "pal-link pal-identity-label";
    link.href = `https://www.palpedia.net/map?pal=${encodeURIComponent(String(displayName ?? "").trim())}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = displayName;
    return link;
}

function hasPalTooltipData(pal) {
    if (!pal) {
        return false;
    }

    return (
        (Array.isArray(pal.elementTypes) && pal.elementTypes.length > 0) ||
        Number.isFinite(pal.hp) ||
        Number.isFinite(pal.meleeAttack) ||
        Number.isFinite(pal.shotAttack) ||
        Number.isFinite(pal.defense) ||
        Number.isFinite(pal.walkSpeed) ||
        Number.isFinite(pal.runSpeed) ||
        Number.isFinite(pal.rideSprintSpeed) ||
        Number.isFinite(pal.workSpeed) ||
        Number.isFinite(pal.foodAmount) ||
        (Array.isArray(pal.possibleDrops) && pal.possibleDrops.length > 0) ||
        buildActiveWorkSuitabilityEntries(pal).length > 0 ||
        pal.isNocturnal ||
        pal.isPredator ||
        Number.isFinite(pal.maleProbability)
    );
}

function initializePalTooltip() {
    const tooltip = document.createElement("div");
    tooltip.className = "pal-tooltip";
    tooltip.hidden = true;
    tooltip.setAttribute("role", "tooltip");
    document.body.appendChild(tooltip);

    state.palTooltip = {
        element: tooltip,
        anchor: null,
        palId: ""
    };

    window.addEventListener("scroll", handlePalTooltipViewportChange, { passive: true });
    window.addEventListener("resize", handlePalTooltipViewportChange);
    document.addEventListener("keydown", handlePalTooltipKeydown);
}

function attachPalTooltip(trigger, pal) {
    trigger.addEventListener("mouseenter", () => {
        showPalTooltip(trigger, pal);
    });
    trigger.addEventListener("mouseleave", hidePalTooltip);
    trigger.addEventListener("focusin", () => {
        showPalTooltip(trigger, pal);
    });
    trigger.addEventListener("focusout", (event) => {
        if (trigger.contains(event.relatedTarget)) {
            return;
        }

        hidePalTooltip();
    });
}

function showPalTooltip(anchor, pal) {
    if (!state.palTooltip || !anchor || !pal) {
        return;
    }

    state.palTooltip.anchor = anchor;
    state.palTooltip.palId = String(pal.id ?? "");
    renderPalTooltipContent(pal);
    state.palTooltip.element.hidden = false;
    positionPalTooltip();
}

function hidePalTooltip() {
    if (!state.palTooltip) {
        return;
    }

    state.palTooltip.anchor = null;
    state.palTooltip.palId = "";
    state.palTooltip.element.hidden = true;
    state.palTooltip.element.replaceChildren();
}

function handlePalTooltipViewportChange() {
    if (!state.palTooltip || state.palTooltip.element.hidden) {
        return;
    }

    if (!state.palTooltip.anchor || !state.palTooltip.anchor.isConnected) {
        hidePalTooltip();
        return;
    }

    positionPalTooltip();
}

function handlePalTooltipKeydown(event) {
    if (event.key === "Escape") {
        hidePalTooltip();
    }
}

function renderPalTooltipContent(pal) {
    if (!state.palTooltip) {
        return;
    }

    state.palTooltip.element.replaceChildren(buildPalTooltipCard(pal));
}

function buildPalTooltipCard(pal) {
    const panel = document.createElement("section");
    panel.className = "pal-tooltip-panel";

    const header = document.createElement("div");
    header.className = "pal-tooltip-header";
    header.appendChild(createPalIdentity(pal, {
        variant: "tooltip",
        link: false,
        tooltip: false,
        loading: "eager"
    }));
    panel.appendChild(header);

    const meta = document.createElement("div");
    meta.className = "pal-tooltip-chip-list";
    for (const elementType of pal.elementTypes ?? []) {
        meta.appendChild(createPalTooltipChip(elementType, "pal-tooltip-chip pal-tooltip-chip-element"));
    }
    if (pal.rarity) {
        meta.appendChild(createBadge(
            formatRarity(pal.rarity),
            `badge badge-rarity ${pal.rarity.className}`));
    }
    if (meta.childElementCount > 0) {
        panel.appendChild(meta);
    }

    const metrics = buildPalTooltipMetrics(pal);
    if (metrics.length > 0) {
        const metricGrid = document.createElement("div");
        metricGrid.className = "pal-tooltip-metrics";
        metrics.forEach((metric) => {
            metricGrid.appendChild(createPalTooltipMetric(metric.label, metric.value));
        });
        panel.appendChild(metricGrid);
    }

    const workEntries = buildActiveWorkSuitabilityEntries(pal);
    if (workEntries.length > 0) {
        panel.appendChild(createPalTooltipSection(
            "Work Suitability",
            workEntries.map((entry) => createPalTooltipChip(
                `${entry.label} Lv. ${entry.level}`,
                "pal-tooltip-chip pal-tooltip-chip-work"
            ))
        ));
    }

    const possibleDrops = buildPalTooltipDropEntries(pal);
    if (possibleDrops.length > 0) {
        panel.appendChild(createPalTooltipSection(
            "Possible Drops",
            possibleDrops.map((drop) => createPalTooltipChip(
                formatPalTooltipDrop(drop),
                "pal-tooltip-chip"
            ))
        ));
    }

    const traits = buildPalTooltipTraits(pal);
    if (traits.length > 0) {
        panel.appendChild(createPalTooltipSection(
            "Traits",
            traits.map((trait) => createPalTooltipChip(
                trait,
                "pal-tooltip-chip pal-tooltip-chip-trait"
            ))
        ));
    }

    return panel;
}

function buildPalTooltipMetrics(pal) {
    const metrics = [
        { label: "HP", value: pal.hp },
        { label: "Melee", value: pal.meleeAttack },
        { label: "Ranged", value: pal.shotAttack },
        { label: "Defense", value: pal.defense },
        { label: "Walk Speed", value: pal.walkSpeed },
        { label: "Run Speed", value: pal.runSpeed },
        { label: "Ride Sprint", value: pal.rideSprintSpeed },
        { label: "Work Speed", value: pal.workSpeed },
        { label: "Food", value: pal.foodAmount }
    ];

    return metrics
        .filter((metric) => Number.isFinite(metric.value))
        .map((metric) => ({
            label: metric.label,
            value: formatTooltipNumber(metric.value)
        }));
}

function buildActiveWorkSuitabilityEntries(pal) {
    return WORK_SUITABILITY_DEFINITIONS
        .map((definition) => ({
            key: definition.key,
            label: definition.label,
            level: Number(pal?.workSuitabilities?.[definition.key] ?? 0)
        }))
        .filter((entry) => entry.level > 0);
}

function buildPalTooltipTraits(pal) {
    const traits = [];

    if (pal.isNocturnal) {
        traits.push("Nocturnal");
    }

    if (pal.isPredator) {
        traits.push("Predator");
    }

    if (Number.isFinite(pal.maleProbability) && pal.maleProbability !== 50) {
        traits.push(`${formatTooltipNumber(pal.maleProbability)}% Male`);
    }

    return traits;
}

function buildPalTooltipDropEntries(pal) {
    if (!Array.isArray(pal?.possibleDrops)) {
        return [];
    }

    return pal.possibleDrops.filter((drop) => drop && drop.displayName);
}

function createPalTooltipSection(title, children) {
    const section = document.createElement("section");
    section.className = "pal-tooltip-section";

    const label = document.createElement("p");
    label.className = "pal-tooltip-section-label";
    label.textContent = title;

    const list = document.createElement("div");
    list.className = "pal-tooltip-chip-list";
    children.forEach((child) => {
        list.appendChild(child);
    });

    section.append(label, list);
    return section;
}

function createPalTooltipMetric(label, value) {
    const item = document.createElement("div");
    item.className = "pal-tooltip-metric";

    const metricLabel = document.createElement("span");
    metricLabel.className = "pal-tooltip-metric-label";
    metricLabel.textContent = label;

    const metricValue = document.createElement("span");
    metricValue.className = "pal-tooltip-metric-value";
    metricValue.textContent = value;

    item.append(metricLabel, metricValue);
    return item;
}

function createPalTooltipChip(text, className) {
    const chip = document.createElement("span");
    chip.className = className;
    chip.textContent = text;
    return chip;
}

function formatTooltipNumber(value) {
    return Number(value).toLocaleString("en-US");
}

function formatTooltipPercent(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return "";
    }

    return Number.isInteger(numericValue)
        ? numericValue.toLocaleString("en-US")
        : numericValue.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function normalizePalDropEntries(drops) {
    if (!Array.isArray(drops)) {
        return [];
    }

    return drops
        .map((drop) => {
            const itemId = String(drop?.ItemId ?? "").trim();
            const displayName = String(drop?.DisplayName ?? itemId).trim();
            const dropRate = Number(drop?.DropRate ?? 0);
            const minCount = Number(drop?.MinCount ?? 0);
            const maxCount = Number(drop?.MaxCount ?? 0);
            const minLevel = Number(drop?.MinLevel ?? 0);

            if (!displayName || !Number.isFinite(dropRate) || dropRate <= 0) {
                return null;
            }

            return {
                itemId,
                displayName,
                dropRate,
                minCount: Number.isFinite(minCount) ? minCount : 0,
                maxCount: Number.isFinite(maxCount) ? maxCount : 0,
                minLevel: Number.isFinite(minLevel) ? minLevel : 0
            };
        })
        .filter(Boolean);
}

function formatPalTooltipDrop(drop) {
    const quantityText = formatPalTooltipDropQuantity(drop.minCount, drop.maxCount);
    const rateText = formatTooltipPercent(drop.dropRate);
    const levelText = Number.isFinite(drop.minLevel) && drop.minLevel > 0
        ? `, Lv. ${formatTooltipNumber(drop.minLevel)}+`
        : "";
    const suffixParts = [];

    if (quantityText) {
        suffixParts.push(quantityText);
    }

    if (rateText) {
        suffixParts.push(`${rateText}%`);
    }

    const suffix = suffixParts.length > 0
        ? ` (${suffixParts.join(", ")}${levelText})`
        : (levelText ? ` (${levelText.slice(2)})` : "");

    return `${drop.displayName}${suffix}`;
}

function formatPalTooltipDropQuantity(minCount, maxCount) {
    if (!Number.isFinite(minCount) || !Number.isFinite(maxCount) || maxCount <= 0) {
        return "";
    }

    if (minCount > 0 && minCount === maxCount) {
        return `x${formatTooltipNumber(minCount)}`;
    }

    const minimum = minCount > 0 ? formatTooltipNumber(minCount) : "0";
    return `x${minimum}-${formatTooltipNumber(maxCount)}`;
}

function positionPalTooltip() {
    if (!state.palTooltip || state.palTooltip.element.hidden || !state.palTooltip.anchor) {
        return;
    }

    const anchorRect = state.palTooltip.anchor.getBoundingClientRect();
    const tooltipRect = state.palTooltip.element.getBoundingClientRect();

    if (anchorRect.bottom < 0 || anchorRect.top > window.innerHeight) {
        hidePalTooltip();
        return;
    }

    let left = anchorRect.left + ((anchorRect.width - tooltipRect.width) / 2);
    left = Math.max(
        PAL_TOOLTIP_VIEWPORT_MARGIN,
        Math.min(left, window.innerWidth - tooltipRect.width - PAL_TOOLTIP_VIEWPORT_MARGIN)
    );

    let top = anchorRect.bottom + PAL_TOOLTIP_OFFSET;
    if (top + tooltipRect.height > window.innerHeight - PAL_TOOLTIP_VIEWPORT_MARGIN) {
        top = anchorRect.top - tooltipRect.height - PAL_TOOLTIP_OFFSET;
    }
    if (top < PAL_TOOLTIP_VIEWPORT_MARGIN) {
        top = PAL_TOOLTIP_VIEWPORT_MARGIN;
    }

    state.palTooltip.element.style.left = `${Math.round(left)}px`;
    state.palTooltip.element.style.top = `${Math.round(top)}px`;
}

function formatRarity(rarity) {
    if (!rarity) {
        return "Unknown";
    }

    return `${rarity.label} ${rarity.value}`;
}

function normalizeGender(value) {
    return String(value ?? "").trim();
}

function cleanDisplayName(displayName, fallbackIdentifier) {
    const trimmed = String(displayName ?? "").trim();
    if (!trimmed || trimmed.toLowerCase() === "en_text") {
        return humanizeIdentifier(fallbackIdentifier);
    }

    return trimmed;
}

function compareCandidates(left, right) {
    return left.displayName.localeCompare(right.displayName) ||
        left.tribeName.localeCompare(right.tribeName);
}

function comparePairs(left, right) {
    const leftMetrics = buildPairSortMetrics(left);
    const rightMetrics = buildPairSortMetrics(right);

    return leftMetrics.totalRarity - rightMetrics.totalRarity ||
        leftMetrics.highestRarity - rightMetrics.highestRarity ||
        leftMetrics.lowestRarity - rightMetrics.lowestRarity ||
        leftMetrics.uniquePriority - rightMetrics.uniquePriority ||
        leftMetrics.firstParentName.localeCompare(rightMetrics.firstParentName) ||
        leftMetrics.secondParentName.localeCompare(rightMetrics.secondParentName) ||
        leftMetrics.firstParentId.localeCompare(rightMetrics.firstParentId) ||
        leftMetrics.secondParentId.localeCompare(rightMetrics.secondParentId) ||
        leftMetrics.firstParentGender.localeCompare(rightMetrics.firstParentGender) ||
        leftMetrics.secondParentGender.localeCompare(rightMetrics.secondParentGender);
}

function buildPairSortMetrics(pair) {
    const normalizedParents = [
        {
            parent: pair.parentA,
            gender: String(pair.parentAGenderRequirement ?? "").trim().toLowerCase()
        },
        {
            parent: pair.parentB,
            gender: String(pair.parentBGenderRequirement ?? "").trim().toLowerCase()
        }
    ].sort((left, right) =>
        left.parent.displayName.localeCompare(right.parent.displayName) ||
        left.parent.tribeName.localeCompare(right.parent.tribeName) ||
        left.gender.localeCompare(right.gender)
    );

    const rarityValues = normalizedParents.map((entry) => getComparableRarity(entry.parent.rarityValue));

    return {
        totalRarity: rarityValues[0] + rarityValues[1],
        highestRarity: Math.max(rarityValues[0], rarityValues[1]),
        lowestRarity: Math.min(rarityValues[0], rarityValues[1]),
        uniquePriority: pair.rule === "unique_combo" ? 0 : 1,
        firstParentName: normalizedParents[0].parent.displayName,
        secondParentName: normalizedParents[1].parent.displayName,
        firstParentId: normalizedParents[0].parent.tribeName,
        secondParentId: normalizedParents[1].parent.tribeName,
        firstParentGender: normalizedParents[0].gender,
        secondParentGender: normalizedParents[1].gender
    };
}

function registerAlias(aliasMap, aliasValue, candidateId) {
    const aliases = [aliasValue, normalizeIdentifier(aliasValue)];
    for (const alias of aliases) {
        const normalized = String(alias ?? "").trim().toLowerCase();
        if (!normalized || aliasMap.has(normalized)) {
            continue;
        }

        aliasMap.set(normalized, candidateId);
    }
}

function lookupAlias(aliasMap, rawValue) {
    const key = String(rawValue ?? "").trim().toLowerCase();
    if (!key) {
        return null;
    }

    return aliasMap.get(key) ?? null;
}

function normalizeIdentifier(value) {
    let normalized = String(value ?? "").trim();
    if (!normalized) {
        return "";
    }

    normalized = normalized.replace(/\\/g, "/");
    const slashIndex = normalized.lastIndexOf("/");
    if (slashIndex >= 0 && slashIndex < normalized.length - 1) {
        normalized = normalized.slice(slashIndex + 1);
    }

    const dotIndex = normalized.indexOf(".");
    if (dotIndex >= 0) {
        normalized = normalized.slice(0, dotIndex);
    }

    if (normalized.endsWith("_C")) {
        normalized = normalized.slice(0, -2);
    }

    if (normalized.startsWith("BP_")) {
        normalized = normalized.slice(3);
    }

    return normalized.trim();
}

function stripKnownPrefixes(value) {
    let normalized = String(value ?? "").trim();
    if (!normalized) {
        return "";
    }

    for (const prefix of ["BOSS_", "RAID_"]) {
        if (normalized.startsWith(prefix)) {
            normalized = normalized.slice(prefix.length);
        }
    }

    return normalized;
}

function humanizeIdentifier(value) {
    const normalized = normalizeIdentifier(value);
    if (!normalized) {
        return "";
    }

    return normalized
        .replace(/_/g, " ")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/\s+/g, " ")
        .trim();
}
