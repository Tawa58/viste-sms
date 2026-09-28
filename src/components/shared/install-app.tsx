import { useState, type ReactNode } from 'react'
import { Copy, Download, Share, SquarePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { copyText } from '@/lib/native-app'
import { notify } from '@/lib/notify'
import { promptInstall, useInstallMode, type InstallMode } from '@/lib/pwa'

/** Install action plus the help dialog it may open. Render `dialog` wherever the action is used. */
export function useInstallApp(): { mode: InstallMode; start: () => void; dialog: ReactNode } {
  const mode = useInstallMode()
  const [helpOpen, setHelpOpen] = useState(false)

  function start() {
    if (mode === 'prompt') {
      void promptInstall().then((accepted) => {
        if (accepted) notify.success('Viste SMS is being added to your home screen')
      })
      return
    }
    setHelpOpen(true)
  }

  const dialog = (
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Install Viste SMS</DialogTitle>
          <DialogDescription>
            Add the app to your home screen. It opens full screen and signs in like the website.
          </DialogDescription>
        </DialogHeader>
        {mode === 'ios' ? (
          <ol className="space-y-3 text-sm">
            <li className="flex items-start gap-3">
              <Share className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                In Safari, tap the <strong>Share</strong> button.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <SquarePlus className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                Choose <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.
              </span>
            </li>
          </ol>
        ) : (
          <div className="space-y-3 text-sm">
            <p>
              This browser can't install apps. Open this page in <strong>Google Chrome</strong>,
              then tap <strong>Install app</strong>.
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                void copyText(window.location.origin).then(
                  () => notify.success('Link copied — paste it into Chrome'),
                  () => notify.error('Could not copy the link'),
                )
              }}
            >
              <Copy className="h-4 w-4" />
              Copy link for Chrome
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )

  return { mode, start, dialog }
}

/** Small "Install app" button; renders nothing when the app can't or needn't be installed. */
export function InstallAppButton({ className }: { className?: string }) {
  const { mode, start, dialog } = useInstallApp()
  if (!mode) return null
  return (
    <div className={className}>
      <Button type="button" variant="outline" size="sm" onClick={start}>
        <Download className="h-4 w-4" />
        Install app
      </Button>
      {dialog}
    </div>
  )
}
