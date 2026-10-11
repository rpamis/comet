import { useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { motion, type TargetAndTransition, type Transition } from 'motion/react';
import type { Stage, StageIconProps, StageStatus } from './types';

export const STAGE_LABELS: Record<Stage, string> = {
  launch: '启动',
  design: '设计',
  build: '构建',
  verify: '验证',
  archive: '归档',
};
export const STATUS_LABELS: Record<StageStatus, string> = {
  idle: '未开始',
  running: '进行中',
  waiting: '等待中',
  success: '已完成',
  error: '出错了',
  blocked: '已阻塞',
};
export const STAGE_COLORS: Record<Stage, string> = {
  launch: '#F15B3C',
  design: '#8152E8',
  build: '#2965EC',
  verify: '#20A480',
  archive: '#EAA321',
};

const QUERY = '(prefers-reduced-motion: reduce)';
const subscribeReducedMotion = (notify: () => void) => {
  const query = window.matchMedia?.(QUERY);
  if (
    typeof query?.addEventListener === 'function' &&
    typeof query.removeEventListener === 'function'
  ) {
    query.addEventListener('change', notify);
    return () => query.removeEventListener('change', notify);
  }
  if (typeof query?.addListener === 'function' && typeof query.removeListener === 'function') {
    query.addListener(notify);
    return () => query.removeListener(notify);
  }
  return () => {};
};
const readReducedMotion = () => window.matchMedia?.(QUERY)?.matches ?? false;
const serverReducedMotion = () => true;

type Scene = { running: boolean; celebrate: boolean; status: StageStatus };
const REST = { x: 0, y: 0, rotate: 0, scale: 1, scaleX: 1, scaleY: 1, opacity: 1 };
const loop: Transition = { duration: 2.5, repeat: Infinity, repeatDelay: 0.8, ease: 'easeInOut' };

/** All properties are reset on every state change. No remounts or stale loop promises. */
function movement(
  scene: Scene,
  frames: TargetAndTransition,
  success?: TargetAndTransition,
  resting: TargetAndTransition = {},
) {
  return {
    initial: scene.running ? { ...REST, ...resting } : (false as const),
    animate: { ...REST, ...resting, ...(scene.running ? frames : scene.celebrate ? success : {}) },
    transition: scene.running
      ? loop
      : scene.celebrate && success
        ? { duration: 0.62, ease: 'easeOut' as const }
        : { duration: 0 },
  };
}

function Launch(scene: Scene) {
  // Anticipation → quick diagonal takeoff → settle. The nose stays inside y=6.
  const timing = [0, 0.18, 0.28, 0.43, 0.55, 0.76, 1];
  const takeoff = movement(
    scene,
    {
      x: [0, -3, -3, 10, 10, 0, 0],
      y: [0, 6, 6, -20, -20, 0, 0],
    },
    { x: [0, -2, 8, 0], y: [0, 4, -16, 0] },
  );
  const flame = movement(
    scene,
    {
      scaleY: [0.35, 0.2, 0.2, 1.35, 0.95, 0.35, 0.35],
      scaleX: [0.75, 0.9, 0.9, 1, 0.82, 0.75, 0.75],
    },
    { scaleY: [0.35, 0.2, 1.25, 0.35], scaleX: [0.75, 0.9, 1, 0.75] },
    { scaleY: 0.35, scaleX: 0.75 },
  );
  const trail = movement(
    scene,
    {
      x: [0, 0, 0, -5, -10, -12, 0],
      y: [0, 0, 0, 6, 11, 14, 0],
      opacity: [0, 0, 0, 1, 0.55, 0, 0],
    },
    { x: [0, -9], y: [0, 10], opacity: [0, 1, 0] },
    { opacity: 0 },
  );
  const dust = movement(
    scene,
    {
      scale: [0.7, 0.7, 0.7, 1, 1.3, 1.5, 0.7],
      opacity: [0, 0, 0, 0.8, 0.4, 0, 0],
    },
    { scale: [0.7, 1.4], opacity: [0, 0.65, 0] },
    { opacity: 0 },
  );
  return (
    <>
      <motion.g
        {...trail}
        transition={scene.running ? { ...loop, times: timing } : trail.transition}
      >
        <path
          d="M25 72L31 58M36 86L42 72M76 98L81 86"
          fill="none"
          stroke="#F7AA62"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </motion.g>
      <motion.g
        {...dust}
        style={{ transformOrigin: '37px 105px' }}
        transition={scene.running ? { ...loop, times: timing } : dust.transition}
      >
        <circle cx="30" cy="106" r="6" fill="#F8C893" />
        <circle cx="42" cy="108" r="8" fill="#F7AA62" />
        <circle cx="53" cy="106" r="5" fill="#F8C893" />
      </motion.g>
      <g transform="translate(0 7)">
        <motion.g
          {...takeoff}
          transition={scene.running ? { ...loop, times: timing } : takeoff.transition}
        >
          <g transform="rotate(21 65 66)">
            <motion.path
              d="M53 88C53 96 58 105 65 109C72 104 77 96 77 88Z"
              fill="#FFB62E"
              style={{ transformOrigin: '65px 88px' }}
              {...flame}
              transition={scene.running ? { ...loop, times: timing } : flame.transition}
            />
            <motion.path
              d="M59 88C59 94 61 99 65 102C69 99 71 94 71 88Z"
              fill="#FFF1B0"
              style={{ transformOrigin: '65px 88px' }}
              {...flame}
              transition={scene.running ? { ...loop, times: timing } : flame.transition}
            />
            <path d="M48 66L35 80C33 82 33 85 35 88L43 98L55 82Z" fill="#F8AC31" />
            <path d="M80 64L91 77C94 81 94 86 92 90L87 99L75 83Z" fill="#F8AC31" />
            <path
              d="M65 18C49 29 44 44 44 60V82C44 88 48 92 54 92H76C82 92 86 88 86 82V60C86 44 81 29 65 18Z"
              fill="#F06439"
            />
            <path
              d="M65 18C65 18 60 42 60 60V92H76C82 92 86 88 86 82V60C86 44 81 29 65 18Z"
              fill="#E94248"
            />
            <path d="M52 33C56 27 60 22 65 18C70 22 75 28 78 34Z" fill="#FFAF34" />
            <circle cx="65" cy="53" r="13" fill="#FFE6BC" />
            <circle cx="65" cy="53" r="7" fill="#F17C51" />
            <path d="M61 76H69V93C69 96 67 100 65 102C62 99 61 96 61 93Z" fill="#FFCA57" />
          </g>
        </motion.g>
      </g>
      <path d="M104 32V40M100 36H108" stroke="#E94248" strokeWidth="4" strokeLinecap="round" />
    </>
  );
}

function Design(scene: Scene) {
  return (
    <>
      <rect
        x="22"
        y="26"
        width="79"
        height="79"
        rx="13"
        fill="#B49AEC"
        transform="rotate(-6 62 66)"
      />
      <rect x="25" y="22" width="79" height="79" rx="12" fill="#EEE7FF" />
      <path d="M37 32H52M57 32H61" stroke="#C8B8EA" strokeWidth="4" strokeLinecap="round" />
      <motion.g
        {...movement(
          scene,
          { x: [0, 25, 25, 0, 0], y: [0, 0, 21, 0, 0], rotate: [0, 90, 90, 0, 0] },
          { scale: [1, 0.87, 1] },
        )}
        style={{ transformOrigin: '51px 57px' }}
      >
        <path d="M36 42H57C62 42 66 46 66 51V72H45C40 72 36 68 36 63Z" fill="#8152E8" />
        <path d="M36 42H49V57H36Z" fill="#A682ED" />
      </motion.g>
      <motion.g
        {...movement(
          scene,
          { x: [0, -26, -26, 0, 0], y: [0, 19, 19, 0, 0], rotate: [0, -90, -90, 0, 0] },
          { y: [0, -5, 0] },
        )}
        style={{ transformOrigin: '83px 54px' }}
      >
        <path d="M73 42H88C93 42 96 46 96 50V65H81C76 65 73 61 73 57Z" fill="#F283BB" />
      </motion.g>
      <motion.g
        {...movement(
          scene,
          { x: [0, 0, -13, 0, 0], y: [0, -27, -27, 0, 0], rotate: [0, 0, -90, 0, 0] },
          { x: [-3, 0] },
        )}
        style={{ transformOrigin: '47px 85px' }}
      >
        <rect x="36" y="79" width="24" height="13" rx="6.5" fill="#F283BB" />
      </motion.g>
      <motion.g
        {...movement(
          scene,
          { x: [0, -23, 0, 0, 0], y: [0, 0, -27, 0, 0], rotate: [0, 90, 0, 0, 0] },
          { rotate: [-12, 0] },
        )}
        style={{ transformOrigin: '82px 83px' }}
      >
        <path d="M72 91V79C72 73 77 69 82 69H96V81C96 87 92 91 86 91Z" fill="#9A6DEB" />
        <circle cx="86" cy="79" r="4" fill="#EEE7FF" />
      </motion.g>
      <path d="M107 16L110 22L117 25L110 28L107 34L104 28L98 25L104 22Z" fill="#F283BB" />
    </>
  );
}

function Build(scene: Scene) {
  const timing = [0, 0.1, 0.18, 0.3, 0.4, 0.5, 0.6, 0.7, 0.82, 1];
  const bottom = movement(
    scene,
    {
      y: [-20, -20, 3, 0, 0, 0, 0, 0, 0, 0],
      opacity: [0, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    },
    { y: [0, -3, 0] },
  );
  const middle = movement(
    scene,
    {
      y: [-24, -24, -24, -24, 3, 0, 0, 0, 0, 0],
      opacity: [0, 0, 0, 1, 1, 1, 1, 1, 1, 1],
    },
    { y: [0, -5, 0] },
  );
  const top = movement(
    scene,
    {
      y: [-18, -18, -18, -18, -18, -18, 3, 0, 0, 0],
      opacity: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1],
    },
    { y: [0, -7, 0] },
  );
  return (
    <>
      <path d="M17 112H107" stroke="#AFC5FA" strokeWidth="4" strokeLinecap="round" />
      <motion.g
        {...bottom}
        transition={scene.running ? { ...loop, times: timing } : bottom.transition}
      >
        <rect x="29" y="74" width="16" height="14" rx="4" fill="#2B65ED" />
        <rect x="58" y="74" width="14" height="14" rx="4" fill="#2B65ED" />
        <rect x="86" y="74" width="14" height="14" rx="4" fill="#2B65ED" />
        <rect x="19" y="84" width="88" height="24" rx="5" fill="#2B65ED" />
        <path d="M29 94H44" stroke="#8FB7FF" strokeWidth="4" strokeLinecap="round" />
      </motion.g>
      <motion.g
        {...middle}
        transition={scene.running ? { ...loop, times: timing } : middle.transition}
      >
        <rect x="54" y="50" width="14" height="14" rx="4" fill="#FFD742" />
        <rect x="82" y="50" width="16" height="14" rx="4" fill="#FFD742" />
        <path
          d="M47 60H103C106 60 108 62 108 65V80C108 83 106 84 103 84H102V78C102 76 100 75 98 75H88C86 75 84 76 84 78V84H74V78C74 76 72 75 70 75H60C58 75 56 76 56 78V84H47C44 84 42 82 42 79V65C42 62 44 60 47 60Z"
          fill="#FFD742"
        />
        <path d="M52 68H67" stroke="#FFF2AB" strokeWidth="4" strokeLinecap="round" />
      </motion.g>
      <motion.g {...top} transition={scene.running ? { ...loop, times: timing } : top.transition}>
        <rect x="32" y="26" width="15" height="14" rx="4" fill="#2965EC" />
        <rect x="59" y="26" width="15" height="14" rx="4" fill="#2965EC" />
        <path
          d="M29 36H76C79 36 81 38 81 41V55C81 58 79 60 76 60H70V54C70 52 68 51 66 51H56C54 51 52 52 52 54V60H29C26 60 24 58 24 55V41C24 38 26 36 29 36Z"
          fill="#2965EC"
        />
        <path d="M34 45H46" stroke="#8FB7FF" strokeWidth="4" strokeLinecap="round" />
      </motion.g>
      <path d="M105 31V39M101 35H109" stroke="#F3BD24" strokeWidth="4" strokeLinecap="round" />
    </>
  );
}

function Verify(scene: Scene) {
  return (
    <>
      <rect
        x="32"
        y="24"
        width="61"
        height="69"
        rx="10"
        fill="#7ED7BE"
        transform="rotate(-8 62 61)"
      />
      <rect
        x="40"
        y="32"
        width="61"
        height="69"
        rx="10"
        fill="#A4E8D3"
        transform="rotate(5 70 66)"
      />
      <rect x="30" y="32" width="61" height="69" rx="10" fill="#E1F8EE" />
      <rect x="41" y="44" width="15" height="15" rx="5" fill="#32B494" />
      <path
        d="M65 47H80M65 56H75M42 73H80M42 83H65"
        stroke="#79CBB2"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M20 45V29C20 26 22 24 25 24H39M86 24H103C106 24 108 26 108 29V45M108 84V100C108 103 106 105 103 105H87M39 105H25C22 105 20 103 20 100V84"
        fill="none"
        stroke="#22A582"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <motion.g
        {...movement(scene, { y: [-27, -27, 27, 27, -27], opacity: [0, 1, 1, 0, 0] }, undefined, {
          opacity: scene.status === 'success' ? 0 : 1,
          y: 0,
        })}
      >
        <path d="M18 65H110" stroke="#23B492" strokeWidth="4" strokeLinecap="round" />
        <rect x="25" y="59" width="77" height="12" rx="6" fill="#29C39E" opacity="0.16" />
        <circle cx="108" cy="65" r="5" fill="#22A582" />
      </motion.g>
      {scene.status === 'success' && (
        <motion.path
          data-success-mark="verify"
          d="M49 70L59 80L78 58"
          fill="none"
          stroke="#159B76"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={{ pathLength: scene.celebrate ? [0, 1] : 1 }}
          transition={{ duration: scene.celebrate ? 0.45 : 0 }}
        />
      )}
    </>
  );
}

function Archive(scene: Scene) {
  return (
    <>
      <path
        d="M22 35C22 30 26 26 31 26H51L62 37H97C103 37 108 42 108 48V90C108 96 103 101 97 101H30C24 101 20 97 20 91Z"
        fill="#EF9632"
      />
      <motion.g
        {...movement(
          scene,
          { y: [7, -13, -13, 7, 7], rotate: [0, -5, -5, 0, 0] },
          { y: [-8, 7], rotate: [-3, 0] },
          { y: 7 },
        )}
        style={{ transformOrigin: '64px 75px' }}
      >
        <path d="M38 24C38 21 40 19 43 19H77L91 33V80H38Z" fill="#FFEAC1" />
        <path d="M77 19V28C77 31 79 33 82 33H91Z" fill="#F5C96B" />
        <path d="M48 44H79M48 55H70" stroke="#E7B153" strokeWidth="5" strokeLinecap="round" />
      </motion.g>
      <motion.g
        {...movement(
          scene,
          { y: [0, 4, 4, -2, 0], scaleY: [1, 0.88, 0.88, 1.03, 1] },
          { y: [0, -3, 0], scaleY: [1, 1.05, 1] },
        )}
        style={{ transformOrigin: '64px 102px' }}
      >
        <path
          d="M17 59C16 55 19 51 23 51H49L58 59H110C114 59 117 63 116 67L108 95C107 100 103 104 98 104H34C28 104 24 100 23 95Z"
          fill="#F9BD38"
        />
        <path
          d="M58 59H110C114 59 117 63 116 67L108 95C107 100 103 104 98 104H72Z"
          fill="#FFD653"
        />
        <rect x="43" y="74" width="31" height="10" rx="5" fill="#FFF0B6" />
      </motion.g>
      <path d="M106 20V28M102 24H110" stroke="#F0A335" strokeWidth="4" strokeLinecap="round" />
    </>
  );
}

function StatusBadge({
  status,
  stage,
  surface,
}: {
  status: StageStatus;
  stage: Stage;
  surface: string;
}) {
  const color = {
    idle: '#ABB0B5',
    running: STAGE_COLORS[stage],
    waiting: '#B58023',
    success: '#21845E',
    error: '#CF4253',
    blocked: '#646675',
  }[status];
  return (
    <g data-status-badge={status}>
      <rect
        x="91"
        y="91"
        width="28"
        height="28"
        rx="10"
        fill={color}
        stroke={surface}
        strokeWidth="4"
      />
      {status === 'idle' && <circle cx="105" cy="105" r="3" fill="white" />}
      {status === 'running' && (
        <path
          d="M100 105H110M105 100L110 105L105 110"
          fill="none"
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {status === 'waiting' && (
        <>
          <path d="M101 100V110M109 100V110" stroke="white" strokeWidth="3" strokeLinecap="round" />
        </>
      )}
      {status === 'success' && (
        <path
          d="M99 105L103 109L111 101"
          fill="none"
          stroke="white"
          strokeWidth="2.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {status === 'error' && (
        <path
          d="M101 101L109 109M109 101L101 109"
          stroke="white"
          strokeWidth="2.7"
          strokeLinecap="round"
        />
      )}
      {status === 'blocked' && (
        <>
          <rect x="99" y="103" width="12" height="9" rx="2" fill="white" />
          <path
            d="M102 103V101C102 97 108 97 108 101V103"
            fill="none"
            stroke="white"
            strokeWidth="2.3"
          />
        </>
      )}
    </g>
  );
}

const SCENES = { launch: Launch, design: Design, build: Build, verify: Verify, archive: Archive };

/** Self-contained SVG. Stable stage keys preserve state; status switches cancel every loop. */
export function StageIcon({
  stage,
  status = 'idle',
  size = 96,
  className,
  style,
  label,
  decorative = false,
  reducedMotion = false,
  surfaceColor = 'var(--stage-icon-surface, #FFFFFF)',
}: StageIconProps) {
  const titleId = useId();
  const systemReduced = useSyncExternalStore(
    subscribeReducedMotion,
    readReducedMotion,
    serverReducedMotion,
  );
  const reduce = reducedMotion || systemReduced;
  const previous = useRef({ status, stage });
  const [celebrate, setCelebrate] = useState(false);

  useLayoutEffect(() => {
    const enteredSuccess =
      previous.current.status !== 'success' &&
      status === 'success' &&
      previous.current.stage === stage;
    previous.current = { status, stage };
    setCelebrate(enteredSuccess && !reduce);
    if (!enteredSuccess || reduce) return;
    const timer = window.setTimeout(() => setCelebrate(false), 650);
    return () => window.clearTimeout(timer);
  }, [status, stage, reduce]);

  const scene: Scene = {
    running: status === 'running' && !reduce,
    celebrate: status === 'success' && celebrate && !reduce,
    status,
  };
  const Illustration = SCENES[stage];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 128 128"
      width={size}
      height={size}
      className={className}
      style={{ display: 'inline-block', flexShrink: 0, overflow: 'visible', ...style }}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-labelledby={decorative ? undefined : titleId}
      data-stage={stage}
      data-status={status}
      data-motion={scene.running ? 'running' : scene.celebrate ? 'success-once' : 'static'}
      data-reduced-motion={reduce ? 'true' : 'false'}
    >
      {!decorative && (
        <title id={titleId}>{label ?? `${STAGE_LABELS[stage]} · ${STATUS_LABELS[status]}`}</title>
      )}
      <Illustration {...scene} />
      <StatusBadge status={status} stage={stage} surface={surfaceColor} />
    </svg>
  );
}
