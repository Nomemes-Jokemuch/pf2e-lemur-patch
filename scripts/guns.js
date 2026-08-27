// Sniper First Strike: поднимает d20 < 5 до 5 (с учётом natural 1)
Hooks.on("preCreateChatMessage", (message, data) => {
    handleSniperFirstStrike(message, data);
});

function handleSniperFirstStrike(message, data) {
    const roll = message.rolls?.[0];
    if (!roll) return;

    const pf2eOptions = message.flags?.pf2e?.context?.options ?? [];
    if (!pf2eOptions.includes("sniper-first-strike")) return;

    // Ищем d20 и активный результат (учитываем Fortune/Misfortune)
    const die = roll.terms?.find(
        term => term instanceof foundry.dice.terms.Die && term.faces === 20
    );
    if (!die?.results?.length) return;

    const result = die.results.find(r => r.active === true) ?? die.results[0];
    const originalDie = result.result;

    // 5+ не трогаем
    if (originalDie >= 5) return;

    const dc = message.flags?.pf2e?.context?.dc?.value;
    if (typeof dc !== "number") {
        console.warn("[Sniper First Strike] Cannot determine DC");
        return;
    }

    const originalTotal = roll.total;

    // Меняем выбранный d20 на 5
    result.result = 5;
    const newTotal = originalTotal + (5 - originalDie);
    roll._total = newTotal;

    // Считаем DoS по новому результату
    let unadjustedDegree;
    if (newTotal >= dc + 10) unadjustedDegree = 3;      // Critical Success
    else if (newTotal >= dc) unadjustedDegree = 2;       // Success
    else if (newTotal <= dc - 10) unadjustedDegree = 0;  // Critical Failure
    else unadjustedDegree = 1;                           // Failure

    // Натуральная 1 всё ещё снижает DoS
    let finalDegree = unadjustedDegree;
    if (originalDie === 1) finalDegree = Math.max(0, finalDegree - 1);

    const outcomes = ["criticalFailure", "failure", "success", "criticalSuccess"];
    const outcome = outcomes[finalDegree];
    const unadjustedOutcome = outcomes[unadjustedDegree];

    console.log(
        `[Sniper First Strike] Selected d20 ${originalDie} → 5 | ` +
        `${originalTotal} → ${newTotal} | AC ${dc} | ` +
        `${unadjustedOutcome} → ${outcome}`
    );

    // Обновляем CheckRoll и PF2e context
    roll.options.degreeOfSuccess = finalDegree;

    const context = message.flags?.pf2e?.context;
    if (context) {
        context.outcome = outcome;
        context.unadjustedOutcome = unadjustedOutcome;

        if (context.contextualOptions?.postRoll) {
            context.contextualOptions.postRoll = context.contextualOptions.postRoll.filter(
                option =>
                    !option.startsWith("check:total:") &&
                    !option.startsWith("check:roll:total:natural:")
            );
            context.contextualOptions.postRoll.push(
                `check:total:${newTotal}`,
                `check:total:natural:5`,
                `check:roll:total:natural:5`,
                `check:total:delta:${newTotal - dc}`
            );
        }
    }

    // Сохраняем оригинальную грань
    foundry.utils.setProperty(data, "flags.sniper-first-strike.originalDie", originalDie);

    // Обновляем HTML результата Strike
    let flavor = data.flavor ?? "";

    const outcomeData = {
        criticalFailure: { className: "criticalFailure", label: "Critical Miss" },
        failure:         { className: "failure",         label: "Failure" },
        success:         { className: "success",         label: "Success" },
        criticalSuccess: { className: "criticalSuccess", label: "Critical Hit" },
    };

    const newOutcome = outcomeData[outcome];

    flavor = flavor.replace(
        /(<div class="result degree-of-success">\s*Result:\s*<span class=")[^"]+(")[^>]*>[^<]*<\/span>/,
        `$1${newOutcome.className}$2>${newOutcome.label}</span>`
    );

    const delta = newTotal - dc;
    flavor = flavor.replace(
        /(<span data-whose="opposer">by )[^<]+(<\/span>)/,
        `$1${delta >= 0 ? "+" : ""}${delta}$2`
    );

    flavor = flavor.trimEnd() + `<div class="roll-note"><strong>Sniper First Strike</strong>: d20 ${originalDie} → 5</div>`;

    // Сохраняем изменённый Roll
    message.updateSource({
        rolls: [roll.toJSON()],
        flavor,
        content: String(newTotal),
    });
}