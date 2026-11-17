<?php
declare(strict_types=1);

namespace Cashier;

final class Statements
{
    public function __construct(private readonly Store $db)
    {
    }

    public function append(array $order, string $event, int $amount, ?string $id = null): void
    {
        if ($amount === 0) {
            return;
        }
        $id ??= Config::token();
        $row = ['id' => $id, 'order_id' => $order['id'], 'out_trade_no' => $order['out_trade_no'],
            'merchant' => $order['merchant'], 'merchant_name' => $order['merchant_name'], 'env' => $order['env'],
            'event' => $event, 'amount' => $amount, 'rail' => $order['rail'] ?? '', 'time' => time()];
        $this->db->put('statement', $id, $row, $row['merchant']);
        $this->db->put('player_statement', $id, $row, $order['payer']);
    }

    public function read(?string $player, ?string $merchant, array $filter, bool $all = false): array
    {
        $env = $filter['environment'] ?? 'live';
        $month = $filter['month'] ?? '';
        if (!in_array($env, ['live', 'sandbox'], true) || !is_string($month)
            || ($month !== '' && !preg_match('/\A\d{4}-(0[1-9]|1[0-2])\z/', $month))) {
            throw new Fault('账单筛选条件无效');
        }
        $rows = $player !== null ? $this->db->list('player_statement', $player) : $this->db->list('statement', $merchant);
        $seen = array_fill_keys(array_column($rows, 'id'), true);
        $orders = $player !== null
            ? array_map(fn ($row) => $this->db->get('order', $row['id']), $this->db->list('player_order', $player))
            : $this->db->list('order', $merchant);
        foreach ($orders as $order) {
            if (!$order || empty($order['captured'])) {
                continue;
            }
            $legacy = ['id' => $order['id'], 'order_id' => $order['id'], 'out_trade_no' => $order['out_trade_no'],
                'merchant' => $order['merchant'], 'merchant_name' => $order['merchant_name'], 'env' => $order['env'],
                'rail' => $order['rail'], 'time' => $order['created']];
            if (!isset($seen[$order['id']])) {
                $rows[] = $legacy + ['event' => 'payment', 'amount' => $order['captured']];
            }
            $historical = $order['legacy_refunded'] ?? (isset($seen[$order['id']]) ? 0 : $order['refunded']);
            if ($historical > 0) {
                $rows[] = array_replace($legacy, ['id' => 'legacy-refund-' . $order['id'], 'event' => 'legacy_refund', 'amount' => -$historical]);
            }
        }
        $rows = array_values(array_filter($rows, static fn ($row) => $row['env'] === $env
            && ($month === '' || Limits::month($row['time']) === $month)
            && ($merchant === null || $merchant === '' || $row['merchant'] === $merchant)));
        usort($rows, static fn ($a, $b) => [$b['time'], $b['id']] <=> [$a['time'], $a['id']]);
        if ($all) {
            return $rows;
        }
        $page = filter_var($filter['page'] ?? 1, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 1000000]]);
        if (!$page) {
            throw new Fault('页码无效');
        }
        return ['items' => array_slice($rows, ($page - 1) * 50, 50), 'total' => count($rows), 'page' => $page, 'page_size' => 50];
    }

    public static function xlsx(array $rows): string
    {
        $entries = [
            '[Content_Types].xml' => '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                . '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                . '<Default Extension="xml" ContentType="application/xml"/>'
                . '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                . '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
            '_rels/.rels' => '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                . '<Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
            'xl/workbook.xml' => '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                . '<sheets><sheet name="交易对账单" sheetId="1" r:id="r1"/></sheets></workbook>',
            'xl/_rels/workbook.xml.rels' => '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                . '<Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
        ];
        $table = [['交易时间（北京时间）', '清算流水号', '清算订单号', '商户订单号', '商户号', '商户', '业务类型', '支付来源', '环境', '有符号金额']];
        foreach ($rows as $row) {
            $table[] = [date('Y-m-d H:i:s', $row['time']), $row['id'], $row['order_id'], $row['out_trade_no'],
                $row['merchant'], $row['merchant_name'],
                ['payment' => '付款', 'refund' => '退款', 'legacy_refund' => '历史累计退款'][$row['event']] ?? $row['event'],
                $row['rail'], $row['env'], $row['amount']];
        }
        $sheet = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            . '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
            . '<cols><col min="1" max="1" width="25" customWidth="1"/><col min="2" max="3" width="38" customWidth="1"/>'
            . '<col min="4" max="6" width="32" customWidth="1"/><col min="7" max="10" width="19" customWidth="1"/></cols><sheetData>';
        foreach ($table as $index => $cells) {
            $sheet .= '<row r="' . ($index + 1) . '">';
            foreach ($cells as $column => $cell) {
                $ref = chr(65 + $column) . ($index + 1);
                $sheet .= is_int($cell) ? '<c r="' . $ref . '"><v>' . $cell . '</v></c>'
                    : '<c r="' . $ref . '" t="inlineStr"><is><t xml:space="preserve">' .
                    htmlspecialchars((string) $cell, ENT_XML1 | ENT_SUBSTITUTE | ENT_DISALLOWED, 'UTF-8') . '</t></is></c>';
            }
            $sheet .= '</row>';
        }
        $entries['xl/worksheets/sheet1.xml'] = $sheet . '</sheetData><autoFilter ref="A1:J' . count($table) . '"/></worksheet>';
        $file = tempnam(Config::runtime(), 'statement-');
        if ($file === false) {
            throw new \RuntimeException('Cannot allocate XLSX file');
        }
        try {
            $zip = new \ZipArchive();
            if ($zip->open($file, \ZipArchive::OVERWRITE) !== true) {
                throw new \RuntimeException('Cannot open XLSX archive');
            }
            foreach ($entries as $name => $xml) {
                $zip->addFromString($name, '<?xml version="1.0" encoding="UTF-8"?>' . $xml);
            }
            if (!$zip->close()) {
                throw new \RuntimeException('Cannot write XLSX archive');
            }
            return (string) file_get_contents($file);
        } finally {
            unlink($file);
        }
    }
}
