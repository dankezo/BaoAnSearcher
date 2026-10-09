import './reading-text.css'

const emphasis = /(\*\*[^*\n]+\*\*|\d+\/\d{4}\/[A-ZĐ0-9-]+|\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d+(?:[.,]\d+)*\s*(?:%|ngày|tháng|năm|tỷ(?:\s+đồng)?|triệu(?:\s+đồng)?|đồng)|không được vượt quá|không được|tối đa|tối thiểu|chưa áp dụng|có hiệu lực|hết hiệu lực|dự thảo|đề xuất|thu hồi|đình chỉ)/giu

function highlighted(text) {
  return text.split(emphasis).map((part, i) => i % 2
    ? <strong key={i}>{part.startsWith('**') ? part.slice(2, -2) : part}</strong>
    : part)
}

export default function ReadingText({ text, className = '' }) {
  if (!text) return null
  const paragraphs = []
  for (const block of String(text).split(/\r?\n+/).filter(line => line.trim())) {
    const sentences = typeof Intl.Segmenter === 'function'
      ? Array.from(new Intl.Segmenter('vi', { granularity: 'sentence' }).segment(block), s => s.segment)
      : block.split(/(?<=[.!?])\s+/).map(s => s + ' ')
    let paragraph = ''
    for (const sentence of sentences) {
      if (paragraph.length && paragraph.length + sentence.length > 360) {
        paragraphs.push(paragraph.trim()); paragraph = ''
      }
      paragraph += sentence
    }
    if (paragraph.trim()) paragraphs.push(paragraph.trim())
  }
  return <div className={`reading-text ${className}`}>{paragraphs.map((p, i) => <p key={i}>{highlighted(p)}</p>)}</div>
}
