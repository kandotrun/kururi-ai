import type { ModelId, ModelOption } from "../contracts";
import type { ConfirmSlipView } from "./confirm-slip";
import {
  modelOptionText,
  modelSwitch,
  sentenceOf,
  switchConfirmContent,
} from "./copy";
import { h, setText } from "./dom";

export interface ModelPickerOptions {
  confirm: ConfirmSlipView;
  onSelect(id: ModelId): void;
}

export interface ModelPickerView {
  readonly element: HTMLFieldSetElement;
  set(current: ModelId, options: readonly ModelOption[]): void;
  setNote(text: string): void;
  ask(option: ModelOption): Promise<boolean>;
}

interface OptionRow {
  option: ModelOption;
  label: HTMLLabelElement;
  input: HTMLInputElement;
  note: HTMLElement;
}

export function createModelPicker(options: ModelPickerOptions): ModelPickerView {
  const list = h("div", { class: "model-options" });
  const element = h("fieldset", { class: "model-picker", hidden: true }, [
    h("legend", { class: "model-legend" }, ["判定モデル"]),
    list,
  ]);

  const reasons = h("div", { class: "model-reasons" });
  element.append(reasons);

  let current: ModelId = "nano";
  let rows: OptionRow[] = [];
  let note = "";

  function sync(): void {
    for (const row of rows) {
      const active = row.option.id === current;
      row.input.checked = active;
      row.label.toggleAttribute("data-current", active);
      setText(row.note, active ? note : "");
      row.label.toggleAttribute("data-loading", active && note !== "");
    }
  }

  function focusChecked(): void {
    const checked = rows.find((row) => row.input.checked);
    checked?.input.focus({ preventScroll: true });
  }

  function ask(option: ModelOption): Promise<boolean> {
    return options.confirm.ask(switchConfirmContent(option), element);
  }

  function choose(row: OptionRow): void {
    sync();
    if (modelSwitch(current, row.option) === "none") {
      return;
    }
    void ask(row.option).then((confirmed) => {
      if (confirmed) {
        row.input.checked = true;
        options.onSelect(row.option.id);
      }
      focusChecked();
    });
  }

  function buildRow(option: ModelOption): OptionRow {
    const text = modelOptionText(option);
    const metaId = `model-${option.id}-meta`;
    const reasonId = `model-${option.id}-reason`;
    const unavailable = !option.available;
    const input = h("input", {
      type: "radio",
      name: "kururi-model",
      value: option.id,
      disabled: unavailable,
      "aria-describedby": unavailable ? `${metaId} ${reasonId}` : metaId,
    });
    const noteElement = h("span", { class: "model-note" });
    const label = h(
      "label",
      {
        class: "model-option",
        "data-model": option.id,
        "data-unavailable": unavailable,
      },
      [
        input,
        h("span", { class: "model-text" }, [
          h("span", { class: "model-name" }, [
            h("b", {}, [text.label]),
            ` ${text.detail}`,
          ]),
          h("span", { class: "model-meta", id: metaId }, [text.meta]),
          noteElement,
        ]),
      ],
    );
    const row: OptionRow = { option, label, input, note: noteElement };
    input.addEventListener("change", () => {
      if (input.checked) {
        choose(row);
      }
    });
    return row;
  }

  return {
    element,
    set(next, available) {
      const hadFocus = list.contains(document.activeElement);
      current = next;
      element.hidden = available.length < 2;
      rows = available.map(buildRow);
      list.replaceChildren(...rows.map((row) => row.label));
      reasons.replaceChildren(
        ...available
          .filter((option) => !option.available)
          .map((option) =>
            h("p", { class: "model-reason", id: `model-${option.id}-reason` }, [
              sentenceOf(option.unavailableReason ?? "このブラウザでは使えません"),
            ]),
          ),
      );
      sync();
      if (hadFocus && !element.hidden) {
        focusChecked();
      }
    },
    setNote(text) {
      if (text === note) {
        return;
      }
      note = text;
      sync();
    },
    ask,
  };
}
