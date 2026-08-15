/**
 * Добавляет эффект Red-Gold Mortality на целевого актёра.
 * @param {ActorPF2e} targetActor   - актёр, на которого накладывается эффект
 * @param {ActorPF2e} originActor   - актёр-источник (тот, кто применил способность)
 * @param {ItemPF2e}  originItem    - предмет, вызвавший эффект (опционально)
 */
async function addRedGoldMortalityEffect(targetActor, originActor, originItem = null) {
    if (!targetActor || !originActor) return;

    // 1. Создаём базовую структуру эффекта (скопировано из модуля)
    const effectData = {
        _id: foundry.utils.randomID(),
        img: "icons/magic/symbols/fleur-de-lis-yellow.webp",
        name: "Effect: Red-Gold Mortality",
        type: "effect",
        system: {
            description: { value: "" },
            duration: {
                expiry: "turn-end",
                sustained: false,
                unit: "unlimited",
                value: -1
            },
            level: { value: 1 },
            // Здесь будут правила эффекта (см. ниже)
            rules: [],
            context: {
                origin: {
                    actor: originActor.uuid,
                    item: originItem?.uuid || null,
                    // при необходимости можно добавить token
                }
            },
            tokenIcon: { show: true },
            traits: { rarity: "common", value: [] },
            slug: "effect-red-gold-mortality"   // важно для вашего хука
        }
    };

    // 2. Добавляем правила, которые есть в оригинальном эффекте.
    effectData.system.rules = [
        {
            key: "GrantItem",
            onDeleteActions: { grantee: "cascade" },
            uuid: "Compendium.pf2e.conditionitems.Item.fBnFDH2MTzgFijKf" // Unconscious
        }
    ];

    // 3. Добавляем эффект актёру
    await targetActor.createEmbeddedDocuments("Item", [effectData]);
}

/**
 * Обрабатывает исцеление от Fast Healing / Regeneration, если на актёре есть эффект Red-Gold Mortality.
 * @param {ChatMessage} message   - сообщение с роллом исцеления
 * @param {object}      data      - данные сообщения (для изменения flavor и т.п.)
 * @param {object}      options   - опции сообщения
 * @param {string}      userId    - ID пользователя, создавшего сообщение
 * @returns {Promise<boolean>} - true, если обработка выполнена
 */
async function handleRedGoldMortalityHealing(message, data, options, userId) {
    // 1. Проверяем, что это исцеление от Fast Healing / Regeneration
    if (!game.ready || !message.isDamageRoll) return false;

    const rolls = Array.isArray(message.rolls) ? message.rolls : null;
    if (!rolls?.length) return false;

    const fastHealingLabel = game.i18n.localize("PF2E.Encounter.Broadcast.FastHealing.fast-healing.ReceivedMessage");
    const regenerationLabel = game.i18n.localize("PF2E.Encounter.Broadcast.FastHealing.regeneration.ReceivedMessage");
    const flavor = message.flavor ?? data.flavor ?? "";

    const isHealingRoll = rolls.some(r => r.kinds?.has?.("healing"));
    const isFastHealingOrRegen = isHealingRoll &&
        (flavor.includes(fastHealingLabel) || flavor.includes(regenerationLabel));

    if (!isFastHealingOrRegen) return false;

    // 2. Получаем актёра и токен
    const actor = message.actor;
    const token = message.token;
    if (!actor || !token) return false;

    // 3. Ищем эффект Red-Gold Mortality
    const effect = actor.itemTypes.effect.find(e => e.slug === "effect-red-gold-mortality");
    if (!effect) return false;

    // 4. Определяем сумму исцеления
    const healAmount = rolls.reduce((sum, r) => sum + (r.total ?? 1), 0);
    if (healAmount <= 0) return false;

    // 5. Находим источник (origin) эффекта
    let originActor = null;
    const originUuid = effect.system?.context?.origin?.actor;
    if (originUuid) originActor = await fromUuid(originUuid);

    if (!originActor) {
        const signature = effect.flags?.pf2e?.origin?.signature ??
                          effect.system?.context?.origin?.signature;
        if (signature) {
            originActor = game.actors.find(a => a.signature === signature) ??
                          canvas.tokens.placeables.find(t => t.actor?.signature === signature)?.actor;
        }
    }
    if (!originActor) return false;

    // 6. Получаем DC источника (Class DC)
    const classDCStat = originActor.classDC ??
                        originActor.getStatistic?.("class-dc") ??
                        originActor.getStatistic?.("classDC");
    const dcValue = classDCStat?.dc?.value ?? originActor.system?.attributes?.classDC?.value;
    if (dcValue == null) return false;

    // 7. Бросаем спасбросок Воли у цели
    const willSave = actor.saves?.will;
    if (!willSave) return false;

    const roll = await willSave.roll({
        dc: { value: dcValue, label: `${originActor.name}'s Class DC` },
        title: "Red-Gold Mortality",
        skipDialog: true,
        extraRollOptions: ["effect:red-gold-mortality"],
    });

    const dos = roll?.degreeOfSuccess ?? roll?.options?.degreeOfSuccess ?? null;

    // 8. Определяем финальное исцеление
    let finalHeal = 0;
    let outcomeText = "";

    if (dos === 3 || dos === "criticalSuccess") {
        finalHeal = healAmount;
        outcomeText = "Critical Success → full healing";
    } else if (dos === 2 || dos === "success") {
        finalHeal = healAmount;
        outcomeText = "Success → full healing";
    } else if (dos === 1 || dos === "failure") {
        finalHeal = Math.floor(healAmount / 2);
        outcomeText = "Failure → half healing";
    } else {
        finalHeal = 0;
        outcomeText = "Critical Failure → no healing";
    }

    // 9. Добавляем информацию в сообщение
    const note = `<br><strong>Red-Gold Mortality</strong> (${outcomeText})`;
    if (data.flavor !== undefined) {
        data.flavor = (data.flavor || "") + note;
    } else {
        message.updateSource({ flavor: (message.flavor || "") + note });
    }
    foundry.utils.setProperty(data, "flags.red-gold-mortality.handled", true);

    // 10. Применяем исцеление (если есть)
    if (finalHeal > 0) {
        const itemRollOptions = message.item?.getRollOptions?.("item") ?? [];
        const rollOptions = new Set([
            ...itemRollOptions,
            ...actor.getSelfRollOptions(),
            "effect:red-gold-mortality",
        ]);

        await actor.applyDamage({
            damage: -finalHeal,
            token,
            item: message.item ?? null,
            rollOptions,
            skipIWR: true,
        });
    }

    // 11. Удаляем эффект Red-Gold Mortality
    if (effect && !effect.deleted) {
        await effect.delete();
    }

    return true;
}

// Хук для создания эффекта (например, после успешной атаки с physical-ikon)
Hooks.on("preCreateChatMessage", async (message, data, options, userId) => {
    // Если это атака с нужным тегом – создаём эффект
    if (message.isAttackRoll) {
        const item = message.item;
        if (item?.system?.traits?.otherTags?.includes("physical-ikon") && message.target?.actor) {
            const originActor = message.actor;
            const targetActor = message.target.actor;
            await addRedGoldMortalityEffect(targetActor, originActor, item);
        }
    }
});

// Хук для обработки исцеления
Hooks.on("preCreateChatMessage", async (message, data, options, userId) => {
    // Игнорируем сообщения, созданные не GM или не текущим пользователем (по вашему усмотрению)
    if (!game.user.isGM && game.user.id !== userId) return;
    await handleRedGoldMortalityHealing(message, data, options, userId);
});