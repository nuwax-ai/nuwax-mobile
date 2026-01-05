// @ts-nocheck
import { raf } from '@/uni_modules/lime-shared/raf';
// #ifndef UNI-APP-X
import { watchEffect, ref, nextTick } from '@/uni_modules/lime-shared/vue'
// #endif

export type TransitionEmitStatus = "before-enter" | "enter" | "after-enter" | "before-leave" | "leave" | "after-leave"
export type TransitionStatus = '' | 'enter' | 'leave';
export type UseTransitionOptions = {
	element ?: Ref<UniElement | null>,
	enterClass ?: string,
	enterActiveClass ?: string,
	enterToClass ?: string,
	leaveClass ?: string,
	leaveActiveClass ?: string,
	leaveToClass ?: string,
	appear ?: boolean,
	defaultName ?: string,
	name ?: () => string,
	visible ?: () => boolean,
	emits ?: (name : TransitionEmitStatus) => void,
	onNextTick ?: (name : TransitionEmitStatus) => Promise<void>,
	duration ?: number
}

type ClassNameMap = Map<string, string>;

export type UseTransitionReturn = {
	state : Ref<boolean>,
	display : Ref<boolean>,
	inited : Ref<boolean>,
	classes : Ref<string>,
	name : Ref<string>,
	finished : () => void,
	toggle : (v : boolean) => void,
}

export function useTransition(options : UseTransitionOptions) : UseTransitionReturn {
	const state = ref(false);
	const display = ref(false);
	const inited = ref(false);
	const classes = ref('');
	const name = ref(options.defaultName ?? 'fade');

	const enterClass = options.enterClass ?? '';
	const enterActiveClass = options.enterActiveClass ?? '';
	const enterToClass = options.enterToClass ?? '';
	const leaveActiveClass = options.leaveActiveClass ?? '';
	const leaveToClass = options.leaveToClass ?? '';
	const leaveClass = options.leaveClass ?? '';

	const appear = options.appear ?? false
	const duration = options.duration ?? 300;

	let status : TransitionStatus = '';
	let isTransitionEnd = false;
	let isTransitioning = false;
	let timeoutId = -1

	const emitEvent = (event : TransitionEmitStatus) => {
		options.emits?.(event);
	};

	// 结束
	const finished = () => {
		if (isTransitionEnd) return;
		isTransitionEnd = true;
		emitEvent(`after-${status}`)
		if (display.value && !state.value) {
			display.value = false
		}
	}

	const sleep = () : Promise<void> => {
		return new Promise((resolve) => {
			nextTick(() => {
				raf(() => {
					// #ifdef APP-ANDROID || APP-IOS || APP-HARMONY
					if (options.element?.value != null) {
						options.element?.value?.getBoundingClientRectAsync()?.then(res => {
							resolve()
						})
					} else {
						resolve()
					}
					// #endif
					// #ifndef APP-ANDROID || APP-IOS || APP-HARMONY
					resolve()
					// #endif
				})
			})
		})
	}

	const getClassNames = (name : string) : ClassNameMap => {
		return new Map<string, string>([
			['enter', `l-${name}-enter l-${name}-enter-active ${enterClass} ${enterActiveClass}`],
			['enter-to', `l-${name}-enter-to l-${name}-enter-active ${enterToClass} ${enterActiveClass}`],
			['leave', `l-${name}-leave l-${name}-leave-active ${leaveClass} ${leaveActiveClass}`],
			['leave-to', `l-${name}-leave-to l-${name}-leave-active ${leaveToClass} ${leaveActiveClass}`]
		])
	};

	const transitionQueue = ref<TransitionStatus[]>([]);

	const performTransition = async (newStatus : TransitionStatus, eventName : TransitionStatus) => {
		if (status == newStatus) return
		transitionQueue.value.push(newStatus);
		if (isTransitioning) return;
		isTransitioning = true;
		// 防止因结束 又切换为开始导致闪烁
		isTransitionEnd = true;
		while (transitionQueue.value.length > 0) {
			const currentStatus = transitionQueue.value.shift()!;
			status = currentStatus;
			emitEvent(`before-${eventName}`);

			await sleep();
			await sleep();
			if (status != currentStatus) continue;

			const classNames = getClassNames(name.value);
			inited.value = true;
			display.value = true;
			classes.value = classNames.get(eventName)!;
			emitEvent(eventName);

			const executeAfterTick = options.onNextTick?.(eventName);
			if (executeAfterTick != null) {
				await executeAfterTick;
			}

			await sleep();
			// #ifdef MP
			await sleep();
			await sleep();
			// #endif
			if (status != currentStatus) continue;
			classes.value = classNames.get(`${eventName}-to`)!;
			// isTransitionEnd = false;
			// 防止最后无法关闭
			if (status == 'leave') {
				setTimeout(() => {
					finished()
				}, duration)
			}

		}
		// 不延迟 会导致快速切换时 因display none 闪烁
		clearTimeout(timeoutId)
		timeoutId = setTimeout(() => {
			if (transitionQueue.value.length == 0 && status == newStatus) {
				isTransitionEnd = false;
			}
		}, duration * 0.8)

		isTransitioning = false;
	}
	// 定义进入过渡的函数
	const enter = () => {
		performTransition('enter', 'enter');
	}


	const leave = () => {
		performTransition('leave', 'leave');
	}

	let init = false;
	watchEffect(() => {
		if (options.visible == null) return
		state.value = options.visible!();
		if (!appear && !init) {
			init = true
			return
		}

		if (state.value) {
			enter()
		} else {
			leave()
		}
	})
	watchEffect(() => {
		if (options.name == null) return
		name.value = options.name!()
	})

	const toggle = (v : boolean) => {
		state.value = v
		if (v) {
			enter()
		} else {
			leave()
		}
	}

	return {
		state,
		inited,
		display,
		classes,
		name,
		finished,
		toggle
	} as UseTransitionReturn
}