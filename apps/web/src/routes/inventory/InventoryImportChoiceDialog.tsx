import { FileSpreadsheet, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type Props = {
  open: boolean
  onClose: () => void
  onChoose: (kind: 'csv' | 'ocr') => void
}

/**
 * Окно с выбором: импорт CSV или AI-распознавание чека.
 * Запускается с одной кнопки «Импорт» на странице склада.
 */
export function InventoryImportChoiceDialog({ open, onClose, onChoose }: Props) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:!max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t('inventory.import_choice.title')}</DialogTitle>
          <DialogDescription>{t('inventory.import_choice.subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 px-5 pb-5 pt-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onChoose('csv')}
            className="border-border hover:border-secondary hover:bg-secondary/5 flex flex-col items-start gap-2 rounded-lg border-2 border-dashed p-4 text-left transition-colors"
          >
            <FileSpreadsheet className="text-brand-teal size-7" strokeWidth={1.6} />
            <p className="text-foreground text-sm font-bold">
              {t('inventory.import_choice.csv_title')}
            </p>
            <p className="text-muted-foreground text-xs">
              {t('inventory.import_choice.csv_subtitle')}
            </p>
          </button>

          <button
            type="button"
            onClick={() => onChoose('ocr')}
            className="border-secondary/40 hover:border-secondary hover:bg-secondary/5 flex flex-col items-start gap-2 rounded-lg border-2 border-dashed p-4 text-left transition-colors"
          >
            <Sparkles className="text-secondary size-7" strokeWidth={1.6} />
            <p className="text-foreground text-sm font-bold">
              {t('inventory.import_choice.ocr_title')}
            </p>
            <p className="text-muted-foreground text-xs">
              {t('inventory.import_choice.ocr_subtitle')}
            </p>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
