// THE FIVE CONTROLS AS A PERSON MEETS THEM (SPEC §58 position 4, criterion 4). One renderer and
// one parser, used by the consent page where a container is created and by the container's own
// page where its leeway changes later. Two copies of this markup would be two promises.
//
// NATIVE CONTROLS, and nothing else: a checkbox is a checkbox and a select is a select, each with
// a real `<label for=…>` and its risk sentence bound by `aria-describedby`, so a screen reader and
// a phone read what a sighted reader reads. Nothing is signalled by colour, and no script runs —
// Delegate's terms unfold with a `:has()` rule, and where that rule is not understood the terms
// are simply visible, which is the safe way to be wrong about a disclosure.
//
// EVERY SWITCH STARTS OFF. The rendered default is unchecked and `small`, so a person who reads
// nothing and clicks through creates the private journal.

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

/**
 * The five, rendered from one container's leeway — or from none at all, which is every switch off.
 * `note` is the sentence that says where these apply, which differs between the two pages and is
 * the one thing a person must not have to guess.
 */
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

/**
 * What the person checked, as a leeway. An unchecked box is absent from a form post, so every
 * switch reads off unless it was turned on — the same default the markup renders, arrived at from
 * the other side. A form that carries none of these fields yields the sealed leeway, so a caller
 * that renders no controls declares nothing wider by accident.
 */
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
