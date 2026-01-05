# 代码高亮测试

## Bash 代码示例

```bash
#!/bin/bash

# 这是一个bash脚本示例
echo "Hello, World!"

# 变量定义
name="User"
echo "Hello, $name!"

# 条件判断
if [ -f "file.txt" ]; then
    echo "文件存在"
else
    echo "文件不存在"
fi

# 循环
for i in {1..5}; do
    echo "数字: $i"
done
```

## JSX 代码示例

```jsx
import React, { useState } from 'react';

function Counter() {
    const [count, setCount] = useState(0);
    
    const handleIncrement = () => {
        setCount(count + 1);
    };
    
    const handleDecrement = () => {
        setCount(count - 1);
    };
    
    return (
        <div className="counter">
            <h2>计数器: {count}</h2>
            <button onClick={handleIncrement}>
                增加
            </button>
            <button onClick={handleDecrement}>
                减少
            </button>
        </div>
    );
}

export default Counter;
```

## JavaScript 代码示例

```javascript
// 这是一个JavaScript函数
function greet(name) {
    return `Hello, ${name}!`;
}

// 箭头函数
const multiply = (a, b) => a * b;

// 类定义
class Calculator {
    constructor() {
        this.result = 0;
    }
    
    add(value) {
        this.result += value;
        return this;
    }
    
    getResult() {
        return this.result;
    }
}

// 使用示例
const calc = new Calculator();
const result = calc.add(5).add(3).getResult();
console.log(result); // 输出: 8
```
