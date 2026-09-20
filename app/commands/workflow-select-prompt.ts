import { cursorHide } from '@inquirer/ansi';
import {
  createPrompt,
  isDownKey,
  isEnterKey,
  isUpKey,
  makeTheme,
  useKeypress,
  usePrefix,
  useState,
  type Theme,
} from '@inquirer/core';
import figures from '@inquirer/figures';
import type { PartialDeep } from '@inquirer/type';
import { styleText } from 'node:util';

export type WorkflowSelectChoice<Value extends string> = {
  name: string;
  short?: string;
  value: Value;
  details: readonly [primary: string, secondary: string, tertiary: string];
};

type WorkflowSelectTheme = {
  icon: {
    cursor: string;
  };
  style: {
    activeName: (text: string) => string;
    activeDetail: (text: string) => string;
    inactiveName: (text: string) => string;
    inactiveDetail: (text: string) => string;
    activeRail: (text: string) => string;
    inactiveRail: (text: string) => string;
    keysHelpTip: (keys: [key: string, action: string][]) => string | undefined;
  };
};

const workflowSelectTheme: Theme<WorkflowSelectTheme> = {
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
    activeName: (text: string) => styleText('bold', styleText('cyan', text)),
    activeDetail: (text: string) => styleText('cyan', text),
    inactiveName: (text: string) => styleText('dim', text),
    inactiveDetail: (text: string) => styleText('dim', text),
    activeRail: (text: string) => styleText('cyan', text),
    inactiveRail: (text: string) => styleText('dim', text),
    keysHelpTip: (keys: [string, string][]) =>
      keys
        .map(([key, action]) => `${styleText('bold', key)} ${styleText('dim', action)}`)
        .join(styleText('dim', ' • ')),
  },
  icon: {
    cursor: styleText('cyan', figures.pointer),
  },
};

export type WorkflowSelectPromptConfig<Value extends string> = {
  message: string;
  choices: readonly WorkflowSelectChoice<Value>[];
  default?: Value;
  theme?: PartialDeep<Theme<WorkflowSelectTheme>>;
};

function displayWidth(text: string): number {
  return Array.from(text).reduce(
    (width, character) => width + (character.codePointAt(0)! > 0xff ? 2 : 1),
    0,
  );
}

function renderChoice<Value extends string>(
  choice: WorkflowSelectChoice<Value>,
  active: boolean,
  labelWidth: number,
  theme: Theme<WorkflowSelectTheme>,
): string {
  const cursor = active ? theme.icon.cursor : ' ';
  const name = active ? theme.style.activeName(choice.name) : theme.style.inactiveName(choice.name);
  const padding = ' '.repeat(Math.max(0, labelWidth - displayWidth(choice.name)));
  const detailIndent = ' '.repeat(2 + labelWidth + 2);
  const [primary, secondary, tertiary] = choice.details;
  const [topRail, middleRail, bottomRail] = active ? ['┏━', '┃ ', '┗━'] : ['┌─', '│ ', '└─'];
  const railStyle = active ? theme.style.activeRail : theme.style.inactiveRail;
  const detailStyle = active ? theme.style.activeDetail : theme.style.inactiveDetail;

  return [
    `${cursor} ${name}${padding}  ${railStyle(topRail)} ${detailStyle(primary)}`,
    `${detailIndent}${railStyle(middleRail)} ${detailStyle(secondary)}`,
    `${detailIndent}${railStyle(bottomRail)} ${detailStyle(tertiary)}`,
  ].join('\n');
}

const workflowSelectPromptBase = createPrompt<string, WorkflowSelectPromptConfig<string>>(
  (config, done) => {
    if (config.choices.length === 0) {
      throw new Error('Workflow selection requires at least one choice');
    }

    const theme = makeTheme(workflowSelectTheme, config.theme) as Theme<WorkflowSelectTheme>;
    const defaultIndex = config.default
      ? config.choices.findIndex((choice) => choice.value === config.default)
      : -1;
    const [status, setStatus] = useState<'idle' | 'done'>('idle');
    const [active, setActive] = useState(defaultIndex >= 0 ? defaultIndex : 0);
    const prefix = usePrefix({ status, theme });

    useKeypress((key) => {
      if (isEnterKey(key)) {
        const selected = config.choices[active];
        if (selected) {
          setStatus('done');
          done(selected.value);
        }
        return;
      }

      if (isUpKey(key) || isDownKey(key)) {
        const offset = isUpKey(key) ? -1 : 1;
        setActive((active + offset + config.choices.length) % config.choices.length);
      }
    });

    const selected = config.choices[active]!;
    const message = theme.style.message(config.message, status);
    if (status === 'done') {
      return [prefix, message, theme.style.answer(selected.short ?? selected.name)].join(' ');
    }

    const labelWidth = Math.max(...config.choices.map((choice) => displayWidth(choice.name)));
    const choices = config.choices
      .map((choice, index) => renderChoice(choice, index === active, labelWidth, theme))
      .join('\n\n');
    const helpLine = theme.style.keysHelpTip([
      ['↑↓', 'navigate'],
      ['⏎', 'select'],
    ]);

    return `${[[prefix, message].join(' '), choices, helpLine]
      .filter(Boolean)
      .join('\n')
      .trimEnd()}${cursorHide}`;
  },
);

export async function workflowSelectPrompt<Value extends string>(
  config: WorkflowSelectPromptConfig<Value>,
): Promise<Value> {
  return (await workflowSelectPromptBase(config as WorkflowSelectPromptConfig<string>)) as Value;
}
