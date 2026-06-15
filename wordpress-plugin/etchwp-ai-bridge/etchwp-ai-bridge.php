<?php
/**
 * Plugin Name:       etchwp-ai Bridge
 * Plugin URI:        https://github.com/flyingwebie/etchwp-ai
 * Description:        Lets the etchwp-ai MCP server drive the Etch builder over a WebSocket instead of Chrome's CDP debug port — no browser flags. Injects an in-page agent into the Etch editor that relays the allowlisted window.etch Public API.
 * Version:           0.1.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Flying Web
 * Author URI:        https://flyingweb.ie
 * License:           MIT
 * Text Domain:       etchwp-ai-bridge
 *
 * @package EtchwpAiBridge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // No direct access.
}

define( 'ETCHWP_AI_BRIDGE_VERSION', '0.1.0' );
define( 'ETCHWP_AI_BRIDGE_FILE', __FILE__ );

/** Option key holding all bridge settings. */
const ETCHWP_AI_BRIDGE_OPTION = 'etchwp_ai_bridge_settings';

/**
 * Default settings. Relay mode is the default because staging/production sites
 * run on real domains, where a loopback (direct) connection would trip Chrome's
 * Local Network Access prompt.
 *
 * @return array<string,mixed>
 */
function etchwp_ai_bridge_defaults() {
	return array(
		'mode'      => 'relay',          // 'relay' | 'direct'
		'relay_url' => '',                // wss://relay.example.com
		'room'      => 'default',
		'token'     => '',
		'host'      => '127.0.0.1',      // direct mode
		'port'      => 9223,             // direct mode
		'use_wss'   => 1,                // direct mode: wss vs ws
	);
}

/**
 * @return array<string,mixed>
 */
function etchwp_ai_bridge_get_settings() {
	$saved = get_option( ETCHWP_AI_BRIDGE_OPTION, array() );
	return wp_parse_args( is_array( $saved ) ? $saved : array(), etchwp_ai_bridge_defaults() );
}

/**
 * Enqueue the in-page agent. It self-gates on `window.etch`, so loading it on
 * any admin/front view a capable user opens is safe — it stays dormant until
 * the Etch builder is actually present.
 */
function etchwp_ai_bridge_enqueue() {
	if ( ! is_user_logged_in() || ! current_user_can( 'edit_posts' ) ) {
		return;
	}

	$settings = etchwp_ai_bridge_get_settings();

	wp_enqueue_script(
		'etchwp-ai-bridge-agent',
		plugins_url( 'assets/agent.js', ETCHWP_AI_BRIDGE_FILE ),
		array(),
		ETCHWP_AI_BRIDGE_VERSION,
		true
	);

	wp_localize_script(
		'etchwp-ai-bridge-agent',
		'EtchwpAiBridge',
		array(
			'mode'     => $settings['mode'],
			'relayUrl' => $settings['relay_url'],
			'room'     => $settings['room'],
			'token'    => $settings['token'],
			'host'     => $settings['host'],
			'port'     => (int) $settings['port'],
			'useWss'   => (bool) $settings['use_wss'],
		)
	);
}
add_action( 'admin_enqueue_scripts', 'etchwp_ai_bridge_enqueue' );
add_action( 'wp_enqueue_scripts', 'etchwp_ai_bridge_enqueue' );

// --- Settings page -----------------------------------------------------------

function etchwp_ai_bridge_register_settings() {
	register_setting(
		'etchwp_ai_bridge',
		ETCHWP_AI_BRIDGE_OPTION,
		array( 'sanitize_callback' => 'etchwp_ai_bridge_sanitize' )
	);
}
add_action( 'admin_init', 'etchwp_ai_bridge_register_settings' );

/**
 * @param array<string,mixed> $input
 * @return array<string,mixed>
 */
function etchwp_ai_bridge_sanitize( $input ) {
	$input = is_array( $input ) ? $input : array();
	return array(
		'mode'      => ( isset( $input['mode'] ) && 'direct' === $input['mode'] ) ? 'direct' : 'relay',
		'relay_url' => isset( $input['relay_url'] ) ? esc_url_raw( trim( (string) $input['relay_url'] ) ) : '',
		'room'      => isset( $input['room'] ) ? sanitize_text_field( (string) $input['room'] ) : 'default',
		'token'     => isset( $input['token'] ) ? sanitize_text_field( (string) $input['token'] ) : '',
		'host'      => isset( $input['host'] ) ? sanitize_text_field( (string) $input['host'] ) : '127.0.0.1',
		'port'      => isset( $input['port'] ) ? max( 1, min( 65535, (int) $input['port'] ) ) : 9223,
		'use_wss'   => ! empty( $input['use_wss'] ) ? 1 : 0,
	);
}

function etchwp_ai_bridge_menu() {
	add_options_page(
		__( 'etchwp-ai Bridge', 'etchwp-ai-bridge' ),
		__( 'etchwp-ai Bridge', 'etchwp-ai-bridge' ),
		'manage_options',
		'etchwp-ai-bridge',
		'etchwp_ai_bridge_settings_page'
	);
}
add_action( 'admin_menu', 'etchwp_ai_bridge_menu' );

function etchwp_ai_bridge_settings_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$s = etchwp_ai_bridge_get_settings();
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'etchwp-ai Bridge', 'etchwp-ai-bridge' ); ?></h1>
		<p><?php esc_html_e( 'Connects the Etch builder to the etchwp-ai MCP server over a WebSocket. These values must match the MCP server\'s ETCH_WS_* environment variables.', 'etchwp-ai-bridge' ); ?></p>
		<form method="post" action="options.php">
			<?php settings_fields( 'etchwp_ai_bridge' ); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><?php esc_html_e( 'Mode', 'etchwp-ai-bridge' ); ?></th>
					<td>
						<label><input type="radio" name="<?php echo esc_attr( ETCHWP_AI_BRIDGE_OPTION ); ?>[mode]" value="relay" <?php checked( $s['mode'], 'relay' ); ?>> <?php esc_html_e( 'Relay (recommended for online sites — no Chrome prompt)', 'etchwp-ai-bridge' ); ?></label><br>
						<label><input type="radio" name="<?php echo esc_attr( ETCHWP_AI_BRIDGE_OPTION ); ?>[mode]" value="direct" <?php checked( $s['mode'], 'direct' ); ?>> <?php esc_html_e( 'Direct (loopback — same machine; one-time Chrome Local Network Access prompt)', 'etchwp-ai-bridge' ); ?></label>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Shared token', 'etchwp-ai-bridge' ); ?></th>
					<td><input type="text" class="regular-text" name="<?php echo esc_attr( ETCHWP_AI_BRIDGE_OPTION ); ?>[token]" value="<?php echo esc_attr( $s['token'] ); ?>" autocomplete="off">
						<p class="description"><?php esc_html_e( 'Must equal ETCH_WS_TOKEN on the MCP server. Use a long random string.', 'etchwp-ai-bridge' ); ?></p></td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Relay URL', 'etchwp-ai-bridge' ); ?></th>
					<td><input type="text" class="regular-text" placeholder="wss://relay.example.com" name="<?php echo esc_attr( ETCHWP_AI_BRIDGE_OPTION ); ?>[relay_url]" value="<?php echo esc_attr( $s['relay_url'] ); ?>">
						<p class="description"><?php esc_html_e( 'Relay mode only. Must equal ETCH_WS_RELAY_URL.', 'etchwp-ai-bridge' ); ?></p></td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Room', 'etchwp-ai-bridge' ); ?></th>
					<td><input type="text" class="regular-text" name="<?php echo esc_attr( ETCHWP_AI_BRIDGE_OPTION ); ?>[room]" value="<?php echo esc_attr( $s['room'] ); ?>">
						<p class="description"><?php esc_html_e( 'Relay mode only. Must equal ETCH_WS_ROOM. Pairs this site with one MCP server.', 'etchwp-ai-bridge' ); ?></p></td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Direct host / port', 'etchwp-ai-bridge' ); ?></th>
					<td>
						<input type="text" name="<?php echo esc_attr( ETCHWP_AI_BRIDGE_OPTION ); ?>[host]" value="<?php echo esc_attr( $s['host'] ); ?>" size="16">
						:
						<input type="number" min="1" max="65535" name="<?php echo esc_attr( ETCHWP_AI_BRIDGE_OPTION ); ?>[port]" value="<?php echo esc_attr( (string) $s['port'] ); ?>">
						<label style="margin-left:1em"><input type="checkbox" name="<?php echo esc_attr( ETCHWP_AI_BRIDGE_OPTION ); ?>[use_wss]" value="1" <?php checked( $s['use_wss'], 1 ); ?>> <?php esc_html_e( 'Use wss (TLS)', 'etchwp-ai-bridge' ); ?></label>
						<p class="description"><?php esc_html_e( 'Direct mode only. Match ETCH_WS_PORT.', 'etchwp-ai-bridge' ); ?></p>
					</td>
				</tr>
			</table>
			<?php submit_button(); ?>
		</form>
	</div>
	<?php
}
