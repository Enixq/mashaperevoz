<?php
declare(strict_types=1);

$recipient = getenv('SITE_RECIPIENT_EMAIL');

if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !$recipient) {
    http_response_code(404);
    exit;
}

$name = trim((string) ($_POST['name'] ?? ''));
$phone = trim((string) ($_POST['phone'] ?? ''));
$service = trim((string) ($_POST['service'] ?? ''));
$callTime = trim((string) ($_POST['call-time'] ?? ''));

if ($phone === '') {
    http_response_code(422);
    exit;
}

$subject = 'Новая заявка с сайта ТЕРРА';
$message = "Имя: {$name}\nТелефон: {$phone}\nУслуга: {$service}\nУдобное время: {$callTime}";
$headers = [
    'Content-Type: text/plain; charset=UTF-8',
    'From: website@' . ($_SERVER['HTTP_HOST'] ?? 'localhost'),
];

mail($recipient, $subject, $message, implode("\r\n", $headers));
header('Location: /#request', true, 303);
exit;
