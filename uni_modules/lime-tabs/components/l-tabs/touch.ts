// @ts-nocheck
// #ifndef UNI-APP-X
import {type Ref, ref} from '@/uni_modules/lime-shared/vue'
type UniTouchEvent = TouchEvent
// #endif

type Direction = '' | 'vertical' | 'horizontal';

function getDirection(x : number, y : number) : Direction {
	if (x > y) {
		return 'horizontal';
	}
	if (y > x) {
		return 'vertical';
	}
	return '';
}

type TouchEventHandler = (event : UniTouchEvent) => void
type BooleanFunction = () => boolean;
type UseTouchResult = {
	start : TouchEventHandler,
	move : TouchEventHandler,
	startX : Ref<number>,
	startY : Ref<number>,
	deltaX : Ref<number>,
	deltaY : Ref<number>,
	offsetX : Ref<number>,
	offsetY : Ref<number>,
	direction : Ref<Direction>,
	isVertical : BooleanFunction,
	isHorizontal : BooleanFunction,
	isTap : Ref<Boolean>,
}
export function useTouch() : UseTouchResult {
	const startX = ref<number>(0);
	const startY = ref<number>(0);
	const deltaX = ref<number>(0);
	const deltaY = ref<number>(0);
	const offsetX = ref<number>(0);
	const offsetY = ref<number>(0);
	const direction = ref<Direction>('');
	const isTap = ref(true);

	const isVertical = () : boolean => direction.value === 'vertical';
	const isHorizontal = () : boolean => direction.value === 'horizontal';

	const reset = () => {
		deltaX.value = 0;
		deltaY.value = 0;
		offsetX.value = 0;
		offsetY.value = 0;
		direction.value = '';
		isTap.value = true;
	};

	const start = (event : UniTouchEvent) => {
		reset();
		startX.value = event.touches[0].clientX;
		startY.value = event.touches[0].clientY;
	}
	const move = (event : UniTouchEvent) => {
		const touch = event.touches[0];
		// safari back will set clientX to negative number
		deltaX.value = (touch.clientX < 0 ? 0 : touch.clientX) - startX.value;
		deltaY.value = touch.clientY - startY.value;
		offsetX.value = Math.abs(deltaX.value);
		offsetY.value = Math.abs(deltaY.value);

		// lock direction when distance is greater than a certain value
		const LOCK_DIRECTION_DISTANCE = 10;
		const TAP_OFFSET = 5;
		if (
			direction.value == '' ||
			(offsetX.value < LOCK_DIRECTION_DISTANCE &&
				offsetY.value < LOCK_DIRECTION_DISTANCE)
		) {
			direction.value = getDirection(offsetX.value, offsetY.value);
		}

		if (
			isTap.value &&
			(offsetX.value > TAP_OFFSET || offsetY.value > TAP_OFFSET)
		) {
			isTap.value = false;
		}
	}
	return {
		start,
		move,
		startX,
		startY,
		deltaX,
		deltaY,
		offsetX,
		offsetY,
		direction,
		isVertical,
		isHorizontal,
		isTap,
	} as UseTouchResult
}