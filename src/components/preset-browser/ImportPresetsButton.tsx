import { FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLibraryStore } from '@/store/libraryStore'
import { useRenderStore } from '@/store/renderStore'

export function ImportPresetsButton() {
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'application/json,.json'
        input.onchange = async () => {
          const file = input.files?.[0]
          if (!file) return
          try {
            const text = await file.text()
            const res = useLibraryStore.getState().importUserPresets(text)
            useRenderStore.setState({ error: res.ok ? null : (res.error ?? 'Import failed') })
          } catch (err) {
            useRenderStore.setState({ error: err instanceof Error ? err.message : 'Import failed' })
          }
        }
        input.click()
      }}
    >
      <FolderOpen /> Import JSON
    </Button>
  )
}
