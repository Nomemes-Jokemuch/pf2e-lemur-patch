const COMMANDER_SCOPE = "nomemes-homebrew";

Hooks.on("renderCharacterSheetPF2e", (sheet, html, data) => {
    const actor = sheet.actor;
    if (actor.type !== "character") return;

    if (actor.itemTypes.feat.some(f => f.slug === "commander-dedication")) return;

    // === Собираем все тактики ===
    const allTactics = actor.itemTypes.action.filter(action =>
        action.system.traits?.value?.includes("tactic")
    );

    // === Убираем тактики из обычных Actions ===
    html.find(".actions-list .action.item").each((_, el) => {
        const itemId = $(el).data("item-id");
        if (allTactics.some(tactic => tactic.id === itemId)) {
            $(el).remove();
        }
    });

    // === Определяем максимальную Tactician-фичу ===
    const tacticianFeats = {
        "tactics": { prepared: 3, pool: 2, rank: 1, tag: "le-commander-trained-tactic" },
        "expert-tactician": { prepared: 4, pool: 4, rank: 2, tag: "le-commander-expert-tactic" },
        "master-tactician": { prepared: 5, pool: 6, rank: 3, tag: "le-commander-master-tactic" },
        "legendary-tactician": { prepared: 6, pool: 8, rank: 4, tag: "le-commander-legendary-tactic" }
    };


    let maxPrepared = 0, maxPoolBase = 0, maxRank = 0;
    let allowedTags = [];
    for (const [slug, values] of Object.entries(tacticianFeats)) {
        if (actor.itemTypes.feat.some(feat => feat.slug === slug)) {
            if (values.rank > maxRank) {
                maxRank = values.rank;
                maxPrepared = values.prepared;
                maxPoolBase = values.pool;
            }
        }
    }
    // === Разрешённые proficiency tags ===
    for (const values of Object.values(tacticianFeats)) {
        if (values.rank <= maxRank) allowedTags.push(values.tag);
    }
    if (maxRank === 0) return;

    // tactical-expansion
    const expansionCount = actor.itemTypes.feat.filter(f => f.slug === "tactical-expansion").length;
    // efficient-preparation
    const hasEfficientPreparation = actor.itemTypes.feat.some(f => f.slug === "efficient-preparation");

    // === Pool ===
    const intMod = actor.abilities.int.mod;
    const totalPool = maxPoolBase + intMod + (expansionCount * 2);
    maxPrepared += hasEfficientPreparation ? 1 : 0;

    // === Prepared tactics ===
    const preparedTactics = allTactics.filter(
        tactic => tactic.getFlag(COMMANDER_SCOPE, "prepared") === true
    );
    const preparedCount = preparedTactics.length;
    const folioCount = allTactics.length;

    // === Ищем Encounter panel ===
    const encounterPanel = html.find('.actions-panel[data-tab="encounter"]');
    if (!encounterPanel.length) return;
    encounterPanel.find(".tactics-section").remove();

    // === Рендер тактик ===
    const tacticsHtml = [...allTactics]
        .sort((a, b) => {
            const aPrep = a.getFlag(COMMANDER_SCOPE, "prepared") === true ? 0 : 1;
            const bPrep = b.getFlag(COMMANDER_SCOPE, "prepared") === true ? 0 : 1;
            if (aPrep !== bPrep) return aPrep - bPrep;
            return a.name.localeCompare(b.name);
        })
        .map(action => renderTacticRow(action))
        .join("");

    // === HTML секции ===
    const section = $(`
        <section class="tactics-section">
            <header class="tactics-header">
                <h3 class="item-name">
                    <i class="fa-solid fa-chess-knight"></i>
                    Tactics
                </h3>
                <div class="tactics-controls">
                    <div class="tactics-counters">
                        <span class="prepared" title="Prepared tactics">Prepared: ${preparedCount} / ${maxPrepared}</span>
                        <span class="pool" title="Tactics known (folio)">Folio: ${folioCount} / ${totalPool}</span>
                    </div>
                    <button type="button" class="add-tactic" title="Add Tactic to Folio">
                        <i class="fa-solid fa-plus"></i> Add Tactic
                    </button>
                    <button type="button" class="tactics-list-btn" title="Open Tactics List Journal">
                        <i class="fa-solid fa-book"></i> Tactics List
                    </button>
                </div>
            </header>
            <ol class="actions-list item-list directory-list tactics-list" data-tactics>
                ${tacticsHtml || `<li class="empty">No tactics in folio</li>`}
            </ol>
        </section>
    `);

    // === Вставляем после Strikes ===
    const strikesList = encounterPanel.find(".strikes-list");
    if (strikesList.length) strikesList.after(section);
    else encounterPanel.prepend(section);

    // === Add Tactic ===
    section.find(".add-tactic").on("click", async () => {
        await openTacticBrowser(actor, allowedTags, totalPool, folioCount);
    });

    section.find(".tactics-list-btn").on("click", async () => {
    const journalUuid = "Compendium.nomemes-homebrew.le-journal.JournalEntry.01VXr5mhDRvjwQHF";
    try {
        const entry = await fromUuid(journalUuid);
        if (entry) {
            entry.sheet.render(true);
        } else {
            ui.notifications.error("Tactics List journal not found.");
        }
    } catch (err) {
        console.error(err);
        ui.notifications.error("Failed to open Tactics List.");
    }
    });

    // === Prepared toggle ===
    section.find(".toggle-prepared").on("click", ev => ev.stopPropagation());
    section.find(".toggle-prepared").on("change", async ev => {
        ev.stopPropagation();
        const checkbox = ev.currentTarget;
        const itemId = $(checkbox).closest(".tactic-item").data("item-id");
        const item = actor.items.get(itemId);
        if (!item) {
            checkbox.checked = false;
            return;
        }
        const wasPrepared = item.getFlag(COMMANDER_SCOPE, "prepared") === true;
        const wantsPrepared = checkbox.checked;
        if (!wantsPrepared) {
            try {
                await item.setFlag(COMMANDER_SCOPE, "prepared", false);
            } catch (error) {
                console.error("Failed to unprepare tactic:", error);
                checkbox.checked = wasPrepared;
            }
            return;
        }
        const otherPreparedCount = allTactics.filter(tactic =>
            tactic.id !== item.id && tactic.getFlag(COMMANDER_SCOPE, "prepared") === true
        ).length;
        if (otherPreparedCount >= maxPrepared) {
            checkbox.checked = false;
            ui.notifications.warn(`You can only prepare ${maxPrepared} tactics.`);
            return;
        }
        try {
            await item.setFlag(COMMANDER_SCOPE, "prepared", true);
        } catch (error) {
            console.error("Failed to prepare tactic:", error);
            checkbox.checked = wasPrepared;
        }
    });

    // === Frequency value change ===
    section.find(".frequency-value").on("change", async ev => {
        ev.stopPropagation();
        const input = ev.currentTarget;
        const itemId = input.dataset.itemId;
        const item = actor.items.get(itemId);
        if (!item?.system?.frequency) {
            input.value = input.defaultValue;
            return;
        }

        const newValue = Math.max(0, Number(input.value) || 0);
        try {
            await item.update({ "system.frequency.value": newValue });
        } catch (error) {
            console.error("Failed to update frequency value:", error);
            input.value = item.system.frequency.value ?? item.system.frequency.max ?? 0;
        }

    });
});

/**
 * Рендер одной строки тактики
 */
function renderTacticRow(action) {

    // Объединяем все теги (value + otherTags)
    const traits = action.system.traits?.value ?? [];
    const otherTags = action.system.traits?.otherTags ?? [];
    const allTags = [...traits, ...otherTags];

    // === Proficiency ===
    let proficiency = "Trained";
    if (allTags.includes("le-commander-legendary-tactic")) proficiency = "Legendary";
    else if (allTags.includes("le-commander-master-tactic")) proficiency = "Master";
    else if (allTags.includes("le-commander-expert-tactic")) proficiency = "Expert";
    else if (allTags.includes("le-commander-trained-tactic")) proficiency = "Trained";

    // === Category ===
    let category = "Utility";
    if (allTags.includes("le-commander-offensive-tactic")) category = "Offensive";
    else if (allTags.includes("le-commander-mobility-tactic")) category = "Mobility";
    else if (allTags.includes("le-commander-utility-tactic")) category = "Utility";

    const hasBrandish = allTags.includes("brandish");

    // === Frequency ===
    let frequencyHtml = "";
    if (action.system.frequency) {
        const freq = action.system.frequency;
        const value = freq.value ?? freq.max ?? 0;
        const max = freq.max ?? 1;
        const per = freq.per ?? "day";

        // Оригинальное форматирование периода (работает с turn/round/PT1M/PT10M/PT1H/PT24H/day/P1W/P1M/P1Y и т.д.)
        let perLabel = per;
        const locKey = `PF2E.Item.Frequency.Per.${per}`;
        if (game.i18n.has(locKey)) {
            perLabel = game.i18n.localize(locKey);
        } else {
            // Fallback на человекочитаемый вид
            const map = {
                turn: "turn",
                round: "round",
                day: "day",
                PT1M: "minute",
                PT10M: "10 minutes",
                PT1H: "hour",
                PT24H: "day",
                P1W: "week",
                P1M: "month",
                P1Y: "year"
            };
            perLabel = map[per] ?? per.replace(/^PT?(\d+)([MHWDY])$/i, (_, n, u) => {
                const units = { M: "minute", H: "hour", D: "day", W: "week", Y: "year" };
                const unit = units[u.toUpperCase()] || u;
                return n === "1" ? unit : `${n} ${unit}s`;
            });
        }

        frequencyHtml = `
            <span class="frequency">
                <input type="number" class="frequency-value" value="${value}" min="0" step="1"
                    data-item-id="${action.id}" title="Current uses">
                <span class="frequency-per">per ${perLabel}</span>
            </span>
        `;
    }

    // === Actions ===
    const glyph = action.actionGlyph ?? action.system.actions?.value ?? "1";

    // === Prepared ===
    const isPrepared = action.getFlag("nomemes-homebrew", "prepared") === true;
    
    // === Category icon ===
    const categoryIcon = { Offensive: "⚔", Utility: "✦", Mobility: "➜" }[category] ?? "•";

    return `
        <li class="action item tactic-item ${isPrepared ? "prepared" : ""}" data-item-id="${action.id}">
            <label class="prepared-toggle" title="Mark as Prepared">
                <input type="checkbox" class="toggle-prepared" ${isPrepared ? "checked" : ""}>
            </label>
            <span class="tactic-icon">${categoryIcon}</span>
            <div class="tactic-info">
                <div class="tactic-main-line">
                    <a class="name" data-action="toggle-summary">${action.name}</a>
                    <a class="action-glyph use-action" data-action="use-action">${glyph}</a>
                    <span class="tactic-meta">${proficiency} ${category}</span>
                    ${hasBrandish ? `<span class="brandish">Brandish</span>` : ""}
                    ${frequencyHtml}
                </div>
            </div>
            <div class="item-controls">
                <a data-action="edit-item" data-tooltip="PF2E.EditItemTitle"><i class="fa-solid fa-fw fa-edit"></i></a>
                <a data-action="delete-item" data-tooltip="PF2E.DeleteItemTitle"><i class="fa-solid fa-fw fa-trash"></i></a>
            </div>
            <div class="item-summary" hidden></div>
        </li>
    `;
}

/**
 * Открывает браузер тактик
 */
async function openTacticBrowser(actor, allowedTags, totalPool, currentCount) {
    if (currentCount >= totalPool) {
        ui.notifications.warn(`Your folio is full (${totalPool} tactics).`);
        return;
    }

    const prof = {
        "le-commander-trained-tactic":   { name: "Trained", rank: 1 },
        "le-commander-expert-tactic":    { name: "Expert", rank: 2 },
        "le-commander-master-tactic":    { name: "Master", rank: 3 },
        "le-commander-legendary-tactic": { name: "Legendary", rank: 4 }
    };

    const cats = {
        "le-commander-mobility-tactic":  { name: "Mobility", rank: 1 },
        "le-commander-utility-tactic":   { name: "Utility", rank: 2 },
        "le-commander-offensive-tactic": { name: "Offensive", rank: 3 }
    };

    const candidates = [];

    for (const pack of game.packs.filter(p => p.documentName === "Item")) {
        const index = await pack.getIndex({
            fields: [
                "type",
                "name",
                "system.traits.value",
                "system.traits.otherTags",
                "img"
            ]
        });

        for (const entry of index) {
            if (entry.type !== "action") continue;

            const traits = entry.system?.traits?.value ?? [];
            const tags = entry.system?.traits?.otherTags ?? [];

            if (!traits.includes("tactic")) continue;

            const profTag = Object.keys(prof).find(tag => tags.includes(tag));
            if (!profTag || !allowedTags.includes(profTag)) continue;

            const catTag = Object.keys(cats).find(tag => tags.includes(tag));

            const exists = actor.itemTypes.action.some(a =>
                a.sourceId === entry.uuid ||
                a._stats?.compendiumSource === entry.uuid ||
                a.name === entry.name
            );

            if (exists) continue;

            candidates.push({
                uuid: entry.uuid,
                name: entry.name,
                img: entry.img,
                prof: prof[profTag],
                cat: cats[catTag] ?? { name: "Utility", rank: 2 }
            });
        }
    }

    if (!candidates.length) {
        ui.notifications.info("No available tactics found matching your proficiency.");
        return;
    }

    candidates.sort((a, b) =>
        a.prof.rank - b.prof.rank ||
        a.cat.rank - b.cat.rank ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );

    const getOptions = () => candidates.map(t =>
        `<option value="${t.uuid}">${t.name} — ${t.cat.name}</option>`
    ).join("");

    let dialog;

    // =========================================================
    // Description
    // =========================================================

    const loadDescription = async (html, uuid) => {
        const preview = html.find(".tactic-preview");

        if (!uuid) {
            preview.html(`
                <div class="tactic-preview-empty">
                    No tactic selected.
                </div>
            `);
            return;
        }

        preview.html(`
            <div class="tactic-preview-loading">
                <i class="fa-solid fa-spinner fa-spin"></i>
                Loading...
            </div>
        `);

        try {
            const item = await fromUuid(uuid);

            if (!item) {
                throw new Error(`Could not resolve ${uuid}`);
            }

            const tactic = candidates.find(t => t.uuid === uuid);
            const raw = item.system?.description?.value ?? "";

            const description = await TextEditor.enrichHTML(raw, {
                async: true
            });

            if (html.find("[name=tactic]").val() !== uuid) return;

            preview.html(`
                <div class="tactic-preview-header">
                    <img
                        src="${item.img}"
                        class="tactic-preview-image"
                    >

                    <div class="tactic-preview-title">
                        <h2>${item.name}</h2>

                        <div class="tactic-preview-meta">
                            <span>${tactic?.prof.name ?? ""}</span>
                            <span>${tactic?.cat.name ?? ""}</span>
                        </div>
                    </div>
                </div>

                <div class="tactic-preview-description">
                    ${description || "<em>No description.</em>"}
                </div>
            `);

        } catch (error) {
            console.error("Failed to load tactic description:", error);

            preview.html(`
                <div class="tactic-preview-empty">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    Failed to load description.
                </div>
            `);
        }
    };

    // =========================================================
    // Add
    // =========================================================

    const addTactic = async html => {
        const select = html.find("[name=tactic]");
        const uuid = select.val();

        if (!uuid) return;

        const folioCount = actor.itemTypes.action.filter(a =>
            a.system.traits?.value?.includes("tactic")
        ).length;

        if (folioCount >= totalPool) {
            ui.notifications.warn(`Your folio is full (${totalPool} tactics).`);
            return;
        }

        const item = await fromUuid(uuid);

        if (!item) {
            ui.notifications.error("Failed to load the selected tactic.");
            return;
        }

        const button = html.find(".tactic-add");

        button.prop("disabled", true);

        try {
            const data = item.toObject();

            delete data._id;

            data.flags = foundry.utils.mergeObject(
                data.flags ?? {},
                {
                    [COMMANDER_SCOPE]: {
                        prepared: false
                    }
                }
            );

            await actor.createEmbeddedDocuments("Item", [data]);

            // Удаляем добавленную тактику из списка
            const index = candidates.findIndex(t => t.uuid === uuid);
            if (index !== -1) candidates.splice(index, 1);

            const newCount = folioCount + 1;

            html.find(".folio-count").text(newCount);

            // Фолио полностью заполнено
            if (newCount >= totalPool) {
                ui.notifications.info(
                    `Your folio is now full (${totalPool} tactics).`
                );

                dialog.close();
                return;
            }

            // Больше тактик нет
            if (!candidates.length) {
                select.empty().prop("disabled", true);

                html.find(".tactic-preview").html(`
                    <div class="tactic-preview-empty">
                        No more tactics available.
                    </div>
                `);

                button.prop("disabled", true);
                return;
            }

            // Перестраиваем список
            select.html(getOptions());

            // Выбираем следующую
            select.val(candidates[0].uuid);

            await loadDescription(html, candidates[0].uuid);

        } catch (error) {
            console.error("Failed to add tactic:", error);

            ui.notifications.error(
                `Failed to add "${item.name}".`
            );

        } finally {
            button.prop("disabled", false);
        }
    };

    // =========================================================
    // Dialog
    // =========================================================

    dialog = new Dialog({
        title: "Add Tactic to Folio",

        content: `
            <form class="tactic-browser">

                <div class="tactic-browser-top">

                    <div class="form-group tactic-selector-group">
                        <label>Select Tactic</label>

                        <select name="tactic" class="tactic-selector">
                            ${getOptions()}
                        </select>
                    </div>

                    <div class="tactic-folio-counter">
                        Folio:
                        <strong class="folio-count">${currentCount}</strong>/<strong>${totalPool}</strong>
                    </div>

                </div>

                <div class="tactic-preview">
                    <div class="tactic-preview-loading">
                        <i class="fa-solid fa-spinner fa-spin"></i>
                        Loading...
                    </div>
                </div>

                <div class="tactic-browser-buttons">
                    <button
                        type="button"
                        class="tactic-add">
                        <i class="fa-solid fa-plus"></i>
                        Add Tactic
                    </button>

                    <button
                        type="button"
                        class="tactic-done">
                        <i class="fa-solid fa-check"></i>
                        Done
                    </button>
                </div>

            </form>
        `,

        buttons: {},

        width: 1600,
        height: 800,
        classes: ["tactic-browser-dialog"],

        render: html => {
            const select = html.find("[name=tactic]");

            select.on("change", () => {
                loadDescription(html, select.val());
            });

            html.find(".tactic-add").on("click", () => {
                addTactic(html);
            });

            html.find(".tactic-done").on("click", () => {
                dialog.close();
            });

            // Сразу показываем первую тактику
            loadDescription(html, select.val());
        }
    });

    dialog.render(true);
}