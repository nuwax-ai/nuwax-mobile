import { addUnit } from '@/uni_modules/lime-shared/addUnit'
export function convertRadius(radius : any) : string[] {
	if (Array.isArray(radius)) {
		const values = radius.map((item) : string|null => addUnit(item))
		if (values.length == 1) {
			return [values[0]!, values[0]!, values[0]!, values[0]!]
		}
		if (values.length == 2) {
			return [values[0]!, values[1]!, values[0]!, values[1]!]
		}
		if (values.length == 3) {
			return [values[0]!, values[1]!, values[2]!, values[1]!]
		}
		if (values.length == 4) {
			return [values[0]!, values[1]!, values[2]!, values[3]!]
		}
		return ['0', '0', '0', '0']
	}
	const value = addUnit(radius) ?? '0'
	return [value, value, value, value]
}