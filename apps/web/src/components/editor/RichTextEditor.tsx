import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import Underline from '@tiptap/extension-underline'
import Youtube from '@tiptap/extension-youtube'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Redo,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo,
  Video,
} from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '@/lib/supabase/client'

type Props = {
  value: string
  onChange: (html: string) => void
  placeholder?: string
}

/**
 * WYSIWYG-редактор на TipTap. Используется в /admin/media для редактирования
 * постов блога. Поддерживает:
 * - Заголовки H1/H2/H3, bold, italic, underline, strike, blockquote, списки
 * - Ссылки, выравнивание текста (left/center/right)
 * - Изображения (загрузка в Supabase Storage bucket `blog-images`)
 * - YouTube / Vimeo embed (через @tiptap/extension-youtube + Vimeo через URL)
 *
 * Возвращает HTML (для хранения в media_posts.body_html). Markdown остаётся
 * в body_md как fallback / для миграции старых постов.
 */
export function RichTextEditor({ value, onChange, placeholder }: Props) {
  const { t } = useTranslation()
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          rel: 'noopener noreferrer nofollow',
          target: '_blank',
        },
      }),
      Image.configure({ HTMLAttributes: { class: 'rounded-md' } }),
      Youtube.configure({
        width: 640,
        height: 360,
        controls: true,
        nocookie: true,
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({
        placeholder: placeholder ?? t('admin.media.editor.placeholder'),
      }),
    ],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none min-h-[400px] focus:outline-none px-4 py-3',
      },
    },
  })

  useEffect(() => {
    if (!editor) return
    if (editor.getHTML() !== value) {
      editor.commands.setContent(value || '')
    }
  }, [value, editor])

  const onImageInsert = useCallback(async () => {
    if (!editor) return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`
      const { error } = await supabase.storage
        .from('blog-images')
        .upload(path, file, { cacheControl: '3600', upsert: false })
      if (error) {
        alert(`Upload error: ${error.message}`)
        return
      }
      const { data } = supabase.storage.from('blog-images').getPublicUrl(path)
      editor.chain().focus().setImage({ src: data.publicUrl, alt: file.name }).run()
    }
    input.click()
  }, [editor])

  const onYoutubeInsert = useCallback(() => {
    if (!editor) return
    const url = prompt(t('admin.media.editor.youtube_prompt'))
    if (!url) return
    // TipTap Youtube extension сама вытащит videoId
    editor.commands.setYoutubeVideo({ src: url })
  }, [editor, t])

  const onVimeoInsert = useCallback(() => {
    if (!editor) return
    const url = prompt(t('admin.media.editor.vimeo_prompt'))
    if (!url) return
    const match = url.match(/vimeo\.com\/(\d+)/)
    if (!match) {
      alert(t('admin.media.editor.vimeo_invalid'))
      return
    }
    const iframe = `<iframe src="https://player.vimeo.com/video/${match[1]}" width="640" height="360" frameborder="0" allow="autoplay; fullscreen" allowfullscreen></iframe>`
    editor.commands.insertContent(iframe)
  }, [editor, t])

  const onLinkInsert = useCallback(() => {
    if (!editor) return
    const prev = editor.getAttributes('link').href as string | undefined
    const url = prompt(t('admin.media.editor.link_prompt'), prev ?? 'https://')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }, [editor, t])

  if (!editor) return null

  return (
    <div className="border-border bg-card overflow-hidden rounded-md border">
      <Toolbar
        editor={editor}
        onImageInsert={onImageInsert}
        onYoutubeInsert={onYoutubeInsert}
        onVimeoInsert={onVimeoInsert}
        onLinkInsert={onLinkInsert}
      />
      <div className="border-border max-h-[560px] overflow-y-auto border-t">
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}

type ToolbarProps = {
  editor: NonNullable<ReturnType<typeof useEditor>>
  onImageInsert: () => void
  onYoutubeInsert: () => void
  onVimeoInsert: () => void
  onLinkInsert: () => void
}

function Toolbar({
  editor,
  onImageInsert,
  onYoutubeInsert,
  onVimeoInsert,
  onLinkInsert,
}: ToolbarProps) {
  return (
    <div className="bg-muted/30 flex flex-wrap items-center gap-0.5 px-2 py-1.5">
      <BtnGroup>
        <BtnIcon
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          icon={Undo}
          title="Undo"
        />
        <BtnIcon
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          icon={Redo}
          title="Redo"
        />
      </BtnGroup>

      <Divider />

      <BtnGroup>
        <BtnIcon
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          active={editor.isActive('heading', { level: 1 })}
          icon={Heading1}
          title="H1"
        />
        <BtnIcon
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor.isActive('heading', { level: 2 })}
          icon={Heading2}
          title="H2"
        />
        <BtnIcon
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor.isActive('heading', { level: 3 })}
          icon={Heading3}
          title="H3"
        />
      </BtnGroup>

      <Divider />

      <BtnGroup>
        <BtnIcon
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
          icon={Bold}
          title="Bold"
        />
        <BtnIcon
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          icon={Italic}
          title="Italic"
        />
        <BtnIcon
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive('underline')}
          icon={UnderlineIcon}
          title="Underline"
        />
        <BtnIcon
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive('strike')}
          icon={Strikethrough}
          title="Strike"
        />
      </BtnGroup>

      <Divider />

      <BtnGroup>
        <BtnIcon
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive('bulletList')}
          icon={List}
          title="Bullet list"
        />
        <BtnIcon
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive('orderedList')}
          icon={ListOrdered}
          title="Numbered list"
        />
        <BtnIcon
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editor.isActive('blockquote')}
          icon={Quote}
          title="Quote"
        />
      </BtnGroup>

      <Divider />

      <BtnGroup>
        <BtnIcon
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          active={editor.isActive({ textAlign: 'left' })}
          icon={AlignLeft}
          title="Align left"
        />
        <BtnIcon
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          active={editor.isActive({ textAlign: 'center' })}
          icon={AlignCenter}
          title="Align center"
        />
        <BtnIcon
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          active={editor.isActive({ textAlign: 'right' })}
          icon={AlignRight}
          title="Align right"
        />
      </BtnGroup>

      <Divider />

      <BtnGroup>
        <BtnIcon onClick={onLinkInsert} icon={LinkIcon} title="Link" />
        <BtnIcon onClick={onImageInsert} icon={ImagePlus} title="Image" />
        <BtnIcon onClick={onYoutubeInsert} icon={Video} title="YouTube" />
        <button
          type="button"
          onClick={onVimeoInsert}
          className="hover:bg-muted text-foreground inline-flex h-7 items-center justify-center rounded px-2 text-[10px] font-bold"
          title="Vimeo"
        >
          Vimeo
        </button>
      </BtnGroup>
    </div>
  )
}

function BtnGroup({ children }: { children: React.ReactNode }) {
  return <div className="inline-flex items-center">{children}</div>
}

function Divider() {
  return <div className="bg-border mx-1.5 h-5 w-px" />
}

function BtnIcon({
  icon: Icon,
  onClick,
  active,
  disabled,
  title,
}: {
  icon: typeof Bold
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={[
        'inline-flex size-7 items-center justify-center rounded transition-colors',
        active ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted',
        disabled ? 'opacity-40' : '',
      ].join(' ')}
    >
      <Icon className="size-3.5" strokeWidth={1.8} />
    </button>
  )
}
