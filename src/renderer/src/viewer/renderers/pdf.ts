import { PlaceholderRenderer, type ViewerHost } from '../renderer'

/** Placeholder until the pdf.js renderer lands. */
export default class PdfRenderer extends PlaceholderRenderer {
  constructor(host: ViewerHost) {
    super(host, 'PDF')
  }
}
