import {
  DELEGATE_CONTROL,
  ENVELOPE_CONTROL,
  ENVELOPE_SIZES,
  LEEWAY_LEDE,
  SWITCH_CONTROLS,
} from "../gateway/leeway-copy.js";
import { SEALED_LEEWAY, type EnvelopeSize, type Leeway, type Terms } from "../gateway/leeway.js";
import { escapeHtml } from "./session.js";

const UNFOLD = `<style>
  fieldset.leeway p.risk { margin: 0.15rem 0 0.9rem 1.6rem; font-size: 0.92rem; }
  fieldset.leeway label { margin: 0.6rem 0 0; }
  fieldset.leeway input[type="checkbox"] { display: inline; width: auto; margin-right: 0.4rem; }
  fieldset.leeway:has(#leeway_delegate:not(:checked)) #delegate_terms { display: none; }
</style>`;

const checkbox = (
  field: string,
  label: string,
  capability: string,
  risk: string,
  on: boolean,
): string =>
  `<label for="${field}"><input type="checkbox" id="${field}" name="${field}" ` +
  `aria-describedby="${field}_risk"${on ? " checked" : ""}> ${escapeHtml(label)} — ` +
  `${escapeHtml(capability)}</label>\n<p class="risk" id="${field}_risk">${escapeHtml(risk)}</p>`;

const envelopeField = (field: string, size: EnvelopeSize, label: string, risk: string): string =>
  `<label for="${field}">${escapeHtml(label)} — ${escapeHtml(ENVELOPE_CONTROL.capability)}</label>\n` +
  `<select id="${field}" name="${field}" aria-describedby="${field}_risk">\n` +
  ENVELOPE_SIZES.map(
    (s) => `<option value="${s}"${s === size ? " selected" : ""}>${s}</option>`,
  ).join("\n") +
  `\n</select>\n<p class="risk" id="${field}_risk">${escapeHtml(risk)}</p>`;

export function leewayFields(leeway: Leeway | undefined, note: string): string {
  const now = leeway ?? SEALED_LEEWAY;
  const terms: Terms | undefined = now.delegate === "off" ? undefined : now.delegate;
  const shown: Terms = terms ?? {
    receive: false,
    offer: false,
    publish: false,
    envelope: "small",
    delegate: "off",
  };
  return `${UNFOLD}<fieldset class="leeway">
<legend>What this container may do</legend>
<p>${escapeHtml(LEEWAY_LEDE)}</p>
<p>${escapeHtml(note)}</p>
${SWITCH_CONTROLS.map((c) =>
  checkbox(`leeway_${c.field}`, c.label, c.capability, c.risk, now[c.field]),
).join("\n")}
${checkbox(
  "leeway_delegate",
  DELEGATE_CONTROL.label,
  DELEGATE_CONTROL.capability,
  DELEGATE_CONTROL.risk,
  terms !== undefined,
)}
<fieldset id="delegate_terms">
<legend>The terms a child may differ within</legend>
${SWITCH_CONTROLS.map((c) =>
  checkbox(`terms_${c.field}`, c.label, c.capability, c.risk, shown[c.field]),
).join("\n")}
<label for="terms_same"><input type="checkbox" id="terms_same" name="terms_same" aria-describedby="terms_same_risk"${
    shown.delegate === "same" ? " checked" : ""
  }> May delegate further — let a child set terms of its own, under these very terms.</label>
<p class="risk" id="terms_same_risk">The risk: the terms you write here carry all the way down, so
every room below this one may hand out what you allow, without you writing the chain out.</p>
${envelopeField("terms_envelope", shown.envelope, "Envelope ceiling", ENVELOPE_CONTROL.risk)}
</fieldset>
${envelopeField("leeway_envelope", now.envelope, ENVELOPE_CONTROL.label, ENVELOPE_CONTROL.risk)}
</fieldset>`;
}

const on = (fields: { get(name: string): string | null | undefined }, field: string): boolean =>
  fields.get(field) !== null && fields.get(field) !== undefined;

const sizeOf = (
  fields: { get(name: string): string | null | undefined },
  field: string,
): EnvelopeSize => {
  const raw = fields.get(field) ?? "";
  return (ENVELOPE_SIZES as readonly string[]).includes(raw) ? (raw as EnvelopeSize) : "small";
};

export function leewayFromFields(fields: { get(name: string): string | null | undefined }): Leeway {
  const terms: Terms = {
    receive: on(fields, "terms_receive"),
    offer: on(fields, "terms_offer"),
    publish: on(fields, "terms_publish"),
    envelope: sizeOf(fields, "terms_envelope"),
    delegate: on(fields, "terms_same") ? "same" : "off",
  };
  return {
    receive: on(fields, "leeway_receive"),
    offer: on(fields, "leeway_offer"),
    publish: on(fields, "leeway_publish"),
    envelope: sizeOf(fields, "leeway_envelope"),
    delegate: on(fields, "leeway_delegate") ? terms : "off",
  };
}
