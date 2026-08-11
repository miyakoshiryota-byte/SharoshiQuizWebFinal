# PDF 重要語句検出 技術検証

## 結論

PDF.js の `getTextContent()` と `getOperatorList()` を併用すれば、文字列、PDF 座標、寸法、フォント、フォントサイズ、ページ番号に、描画時の塗り色を対応付けられる。元 PDF は Canvas のまま表示し、検出候補だけを同じ viewport 上の HTML 枠として重ねる構成にした。暗記用マスクや穴埋め UI はまだ実装していない。

対象教材 PDF 自体はリポジトリに含まれていないため、教材固有の RGB 値と埋め込みフォント名は固定値として断定できない。PDF 選択後、解析結果欄とブラウザ console に実測値を出力する。

## 取得・判定方法

1. `getTextContent()` から文字列、変換行列、幅、高さ、フォントキー、フォントスタイルを取得する。
2. `getOperatorList()` を先頭から走査し、`setFillRGBColor`、`setFillGray`、`setFillCMYKColor` と graphics state の save/restore を追跡する。
3. `setFont` と `showText` / `showSpacedText` の描画 run を作り、空白を除いた文字順で TextContent 項目へ対応付ける。
4. 赤は R が十分大きく G/B より優勢、青は B が十分大きく R/G より優勢、黒は RGB 最大値 70 以下として候補化する。この閾値は教材実測後に調整する前提である。
5. 黒太字は、フォント名だけでなく PDF.js が解決した font object の `bold` / `black` / `fontWeight`、text rendering mode の stroke、同一文字・同一座標への重ね描画を太字根拠として調べる。いずれかの根拠があり、ページ内の文字サイズ中央値の 72〜135% に収まるものだけを候補にする。大型見出しを初期段階で除外するための保守的な条件である。

## 黒太字の追加診断

教材で Bold 名を持たない埋め込みサブセットフォントや疑似太字を比較できるよう、黒文字について `TextItem.fontName`、font family、OperatorList の `setFont` 名、解決後のフォント名・weight・Type3フラグ、フォントサイズ、glyph平均幅、正規化advance、fill/stroke、text rendering mode、線幅、stroke色、同一座標描画回数を収集する。consoleには「黒太字候補」の全件、「通常黒文字」の先頭20件、「黒文字フォント一覧」を別々のtableとして出力する。

太字候補として採用する根拠の優先順位は、(1) font object のbold/weightまたは明示的なBold系名、(2) strokeを含むtext rendering mode、(3) 同一座標への同一文字の反復描画、の順である。glyph幅はフォント差の調査材料として出力するが、文字種やプロポーショナル幅の影響が大きいため、それ単独では太字と判定しない。赤・青の色判定式は変更していない。

## 座標

解析結果には PDF 座標系の `x`、`y`、`width`、`height` と TextContent の変換行列を保持する。表示時は PDF.js の `Util.transform(viewport.transform, item.transform)` と viewport scale を使って Canvas CSS pixel 座標へ変換する。ウィンドウ幅変更時はページを再描画・再解析するため、枠も新しい viewport に追従する。ズーム機能を本実装する場合も、同じ関数へ新しい scale の viewport を渡せばよい。

## 実用化の見込みと注意点

文字が通常の PDF text operator として収録され、教材の赤・青が fill color で指定され、太字が別の Bold 系フォントとして埋め込まれているページでは実用化の見込みが高い。一方、次のケースは追加対応または教材別の閾値調整が必要になる。

- アウトライン化された文字やスキャン画像には TextContent がなく、OCR 禁止条件下では検出できない。
- Pattern、ICC、Separation/DeviceN など `setFillColorN` 系の特殊色空間は、今回の RGB/Gray/CMYK 検証対象外である。
- 一つの TextContent 項目が複数の色 run をまたぐ PDF、縦書き、回転文字、Type3 フォントでは、run と座標の細分化が必要になる可能性がある。
- Bold 系名称を持たず、通常フォントの疑似太字がstrokeまたは重ね描画でもない場合は、PDFの文字情報だけで通常文字と区別できないことがある。
- サイズ条件だけでは小見出しや表ラベルを完全には除外できない。本実装では行内の前後テキスト、行長、ページ上下端、周囲の本文サイズ分布も特徴量に加えることを推奨する。

次段階では、教材数ページの console 出力から赤・青・黒の色クラスタとフォント一覧を確定し、特殊色空間の有無を確認した上で、検出器を純粋関数として分離し、候補を文字 run 単位に細分化して HTML マスク層へ渡す方式を推奨する。
