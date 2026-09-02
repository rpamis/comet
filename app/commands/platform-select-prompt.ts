import { cursorHide } from '@inquirer/ansi';
import {
  createPrompt,
  isDownKey,
  isEnterKey,
  isSpaceKey,
  isUpKey,
  makeTheme,
  useKeypress,
  usePagination,
  usePrefix,
  useState,
  type Theme,
} from '@inquirer/core';
import figures from '@inquirer/figures';
import type { PartialDeep } from '@inquirer/type';
import { styleText } from 'node:util';

export type PlatformSelectChoice<Value extends string> = {
  name: string;
  summaryName?: string;
  value: Value;
  checked?: boolean;
};

type PlatformSelectTheme = {
  icon: {
    checked: string;
    unchecked: string;
    cursor: string;
  };
  style: {
    selectedSummary: (text: string) => string;
    keysHelpTip: (keys: [key: string, action: string][]) => string | undefined;
  };
};

const platformSelectTheme: Theme<PlatformSelectTheme> = {
  prefix: {
    idle: styleText('cyan', '?'),
    done: styleText('green', '✔'),
  },
  spinner: {
    interval: 80,
    frames: ['-', '\\', '|', '/'],
  },
  keybindings: [],
  style: {
    answer: (text: string) => styleText('cyan', text),
    message: (text: string) => styleText('bold', text),
    error: (text: string) => styleText('red', text),
    defaultAnswer: (text: string) => styleText('dim', text),
    help: (text: string) => styleText('dim', text),
    highlight: (text: string) => styleText('cyan', text),
    key: (text: string) => styleText('cyan', text),
    selectedSummary: (text: string) => text,
    keysHelpTip: (keys: [key: string, action: string][]) =>
      keys
        .map(([key, action]) => `${styleText('bold', key)} ${styleText('dim', action)}`)
        .join(styleText('dim', ' • ')),
  },
  icon: {
    checked: styleText('green', figures.circleFilled),
    unchecked: figures.circle,
    cursor: figures.pointer,
  },
};

export type PlatformSelectPromptConfig<Value extends string> = {
  message: string;
  choices: readonly PlatformSelectChoice<Value>[];
  selectedLabel: string;
  emptyLabel: string;
  requiredErrorLabel?: string;
  required?: boolean;
  pageSize?: number;
  theme?: PartialDeep<Theme<PlatformSelectTheme>>;
};

export function getSelectedChoiceNames<Value extends string>(
  choices: readonly PlatformSelectChoice<Value>[],
): string[] {
  return choices
    .filter((choice) => choice.checked === true)
    .map((choice) => choice.summaryName ?? choice.name);
}

export function formatSelectedSummary(
  selectedLabel: string,
  names: readonly string[],
  emptyLabel: string,
): string {
  return `${selectedLabel} ${names.length > 0 ? names.join(', ') : emptyLabel}`;
}

export function renderSelectedSummaryLine(
  selectedLabel: string,
  names: readonly string[],
  emptyLabel: string,
): string {
  return `  ${formatSelectedSummary(selectedLabel, names, emptyLabel)}`;
}

export function toggleChoice<Value extends string>(
  choices: readonly PlatformSelectChoice<Value>[],
  value: Value,
): PlatformSelectChoice<Value>[] {
  return choices.map((choice) =>
    choice.value === value ? { ...choice, checked: choice.checked !== true } : choice,
  );
}

export function selectAllChoices<Value extends string>(
  choices: readonly PlatformSelectChoice<Value>[],
): PlatformSelectChoice<Value>[] {
  return choices.map((choice) => ({ ...choice, checked: true }));
}

export function invertChoices<Value extends string>(
  choices: readonly PlatformSelectChoice<Value>[],
): PlatformSelectChoice<Value>[] {
  return choices.map((choice) => ({ ...choice, checked: choice.checked !== true }));
}

const platformSelectPromptBase = createPrompt<string[], PlatformSelectPromptConfig<string>>(
  (config, done) => {
    const theme = makeTheme(platformSelectTheme, config.theme) as Theme<PlatformSelectTheme>;
    const { pageSize = 7, required = false } = config;
    const [status, setStatus] = useState<'idle' | 'done'>('idle');
    const [items, setItems] = useState<PlatformSelectChoice<string>[]>(
      config.choices.map((choice) => ({ ...choice, checked: choice.checked === true })),
    );
    const [active, setActive] = useState(0);
    const [errorMsg, setError] = useState<string>();
    const prefix = usePrefix({ status, theme });

    useKeypress((key) => {
      if (isEnterKey(key)) {
        const selected = items.filter((item) => item.checked === true);
        if (required && selected.length === 0) {
          setError(config.requiredErrorLabel ?? 'At least one choice must be selected');
          return;
        }

        setStatus('done');
        done(selected.map((item) => item.value));
        return;
      }

      if (items.length === 0) {
        return;
      }

      if (isUpKey(key) || isDownKey(key)) {
        const offset = isUpKey(key) ? -1 : 1;
        setActive((active + offset + items.length) % items.length);
        setError(undefined);
        return;
      }

      if (isSpaceKey(key)) {
        const activeItem = items[active];
        if (activeItem) {
          setItems(toggleChoice(items, activeItem.value));
          setError(undefined);
        }
        return;
      }

      if (key.name === 'a') {
        const hasUnchecked = items.some((item) => item.checked !== true);
        setItems(
          hasUnchecked
            ? selectAllChoices(items)
            : items.map((item) => ({ ...item, checked: false })),
        );
        setError(undefined);
        return;
      }

      if (key.name === 'i') {
        setItems(invertChoices(items));
        setError(undefined);
      }
    });

    const selectedNames = getSelectedChoiceNames(items);
    const message = theme.style.message(config.message, status);
    const page = usePagination({
      items,
      active,
      pageSize,
      loop: true,
      renderItem({ item, isActive }) {
        const cursor = isActive ? theme.icon.cursor : ' ';
        const checkbox = item.checked === true ? theme.icon.checked : theme.icon.unchecked;
        const line = `${cursor}${checkbox} ${item.name}`;
        return isActive ? theme.style.highlight(line) : line;
      },
    });

    if (status === 'done') {
      return [prefix, message, theme.style.answer(selectedNames.join(', '))].join(' ');
    }

    const summary = theme.style.selectedSummary(
      renderSelectedSummaryLine(config.selectedLabel, selectedNames, config.emptyLabel),
    );
    const helpLine = theme.style.keysHelpTip([
      ['↑↓', 'navigate'],
      ['space', 'select'],
      ['a', 'all'],
      ['i', 'invert'],
      ['⏎', 'submit'],
    ]);

    return `${[
      [prefix, message].join(' '),
      summary,
      items.length > 0 ? page : '',
      errorMsg ? theme.style.error(errorMsg) : '',
      helpLine,
    ]
      .filter(Boolean)
      .join('\n')
      .trimEnd()}${cursorHide}`;
  },
);

export async function platformSelectPrompt<Value extends string>(
  config: PlatformSelectPromptConfig<Value>,
): Promise<Value[]> {
  return (await platformSelectPromptBase(config as PlatformSelectPromptConfig<string>)) as Value[];
}
