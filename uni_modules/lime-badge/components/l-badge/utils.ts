export function getOffsetWithMinusString(val : string):string {
	return val.startsWith('-') ? val.replace('-', '') : `-${val}`
};