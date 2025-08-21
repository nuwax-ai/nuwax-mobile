import { MarkdownElement } from '@/types/interfaces/chat'

// Markdown解析器
export class MarkdownParser {
  // 解析markdown文本
  parse(text: string): MarkdownElement[] {
    const elements: MarkdownElement[] = []
    const lines = text.split('\n')
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      
      if (line.startsWith('#')) {
        // 解析标题
        const level = line.match(/^#+/)?.[0].length || 1
        const content = line.replace(/^#+\s*/, '')
        elements.push({
          type: 'heading',
          content: content,
          level: level
        })
      } else if (line.startsWith('```')) {
        // 解析代码块
        const language = line.replace(/^```/, '').trim()
        let codeContent = ''
        i++
        while (i < lines.length && !lines[i].startsWith('```')) {
          codeContent += lines[i] + '\n'
          i++
        }
        elements.push({
          type: 'code',
          content: codeContent.trim(),
          language: language
        })
      } else if (line.startsWith('- ')) {
        // 解析列表
        const content = line.replace(/^-\s*/, '')
        elements.push({
            type: 'list',
            content: content
        })
      } else if (line.startsWith('> ')) {
        // 解析引用
        const content = line.replace(/^>\s*/, '')
        elements.push({
            type: 'blockquote',
            content: content
        })
      } else if (line === '---') {
            // 解析分割线
            elements.push({
                type: 'hr',
                content: ''
            })
        } else if (line.includes('[') && line.includes('](')) {
            // 解析链接
            const match = line.match(/\[([^\]]+)\]\(([^)]+)\)/)
            if (match && match[1] && match[2]) {
            elements.push({
                type: 'link',
                content: match[1],
                href: match[2]
            })
        }
      } else if (line) {
        // 普通文本
        elements.push({
          type: 'text',
          content: line
        })
      }
    }
    
    return elements
  }
}

export const markdownParser = new MarkdownParser()
