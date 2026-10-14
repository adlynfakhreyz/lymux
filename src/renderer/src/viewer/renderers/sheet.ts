import { PlaceholderRenderer, type ViewerHost } from '../renderer'

/** Placeholder until the spreadsheet renderer (SheetJS and a virtualized grid) lands. */
export default class SheetRenderer extends PlaceholderRenderer {
  constructor(host: ViewerHost) {
    super(host, 'Spreadsheet')
  }
}
