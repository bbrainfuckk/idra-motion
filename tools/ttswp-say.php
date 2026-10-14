<?php
/**
 * Narration from TTSWP credits, for idra-motion. See docs/narration.md.
 *
 * TTSWP ("Text to Speech - TTSWP" on wordpress.org) is a WordPress plugin that makes ElevenLabs audio
 * through its own service and charges TTSWP credits for it. Run this on the WordPress site where the
 * plugin is connected, from the site's folder, as the user that owns the site's files:
 *
 *   wp eval-file ttswp-say.php voices                                    voice names and ids
 *   wp eval-file ttswp-say.php say lines.json <voice id> [name] [folder] one MP3 per line
 *
 * lines.json is the same file tools/vo.py reads. Files are named <name>-<id>.mp3 like `vo.py make`,
 * so `vo.py level` and `vo.py words` work on them unchanged. A line that already has its file is
 * skipped, so running it again never pays twice (delete a file to make that line again).
 */

if ( ! class_exists( 'Mementor_TTS_Api_Client' ) ) {
	WP_CLI::error( 'The TTSWP plugin is not active on this site.' );
}
$client  = Mementor_TTS_Api_Client::get_instance();
$command = $args[0] ?? '';

if ( 'voices' === $command ) {
	$voices = $client->get_voices();
	if ( is_wp_error( $voices ) ) {
		WP_CLI::error( $voices->get_error_message() );
	}
	foreach ( $voices['voices'] ?? array() as $voice ) {
		$labels = array_filter( array_map( 'strval', array_values( (array) ( $voice['labels'] ?? array() ) ) ) );
		WP_CLI::log( sprintf( '%-22s %-40s %s', $voice['voice_id'], $voice['name'], implode( ', ', $labels ) ) );
	}
	return;
}

if ( 'say' !== $command || count( $args ) < 3 ) {
	WP_CLI::error( 'Usage: wp eval-file ttswp-say.php voices | say lines.json <voice id> [name] [folder]' );
}
list( , $script, $voice ) = $args;
$name   = $args[3] ?? 'voice';
$folder = rtrim( $args[4] ?? 'vo-raw', '/' );

$lines = json_decode( (string) file_get_contents( $script ), true );
if ( ! is_array( $lines ) ) {
	WP_CLI::error( "Could not read $script as a list of lines." );
}
wp_mkdir_p( $folder );

foreach ( $lines as $line ) {
	$file = "$folder/$name-{$line['id']}.mp3";
	if ( file_exists( $file ) ) {
		WP_CLI::log( "kept $file" );
		continue;
	}
	$result = $client->synthesize( $line['text'], $voice, array( 'filename' => "$name-{$line['id']}" ) );
	if ( is_wp_error( $result ) ) {
		WP_CLI::error( "Line {$line['id']}: " . $result->get_error_message() );
	}
	// The reply carries a signed link that expires within minutes, so download it straight away.
	$link  = $result['audio_url'] ?? $result['url'] ?? '';
	$audio = $link ? wp_remote_get( $link, array( 'timeout' => 60 ) ) : null;
	if ( ! $audio || is_wp_error( $audio ) || 200 !== wp_remote_retrieve_response_code( $audio ) ) {
		WP_CLI::error( "Line {$line['id']}: the audio could not be downloaded." );
	}
	file_put_contents( $file, wp_remote_retrieve_body( $audio ) );
	WP_CLI::log( sprintf(
		'wrote %s (%s credits, %s left): %s',
		$file,
		$result['credits_charged'] ?? '?',
		$result['credits_remaining'] ?? '?',
		$line['text']
	) );
}
