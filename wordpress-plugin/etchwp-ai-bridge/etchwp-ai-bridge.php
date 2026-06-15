<?php
/**
 * Plugin Name:       etchwp-ai Bridge
 * Plugin URI:        https://github.com/flyingwebie/etchwp-ai
 * Description:        Lets the etchwp-ai MCP server drive the Etch builder over a WebSocket instead of Chrome's CDP debug port — no browser flags. Injects an in-page agent into the Etch editor that relays the allowlisted window.etch Public API.
 * Version:           0.2.0
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

define( 'ETCHWP_AI_BRIDGE_VERSION', '0.2.0' );
define( 'ETCHWP_AI_BRIDGE_FILE', __FILE__ );

/** Option key holding all bridge settings. */
const ETCHWP_AI_BRIDGE_OPTION = 'etchwp_ai_bridge_settings';
/** Transient holding the last agent heartbeat (for the live status panel). */
const ETCHWP_AI_BRIDGE_STATUS = 'etchwp_ai_bridge_status';
/** Seconds since the last heartbeat under which the agent counts as "connected". */
const ETCHWP_AI_BRIDGE_FRESH = 20;
/** Shared nonce action for agent heartbeat + settings status poll. */
const ETCHWP_AI_BRIDGE_NONCE = 'etchwp_ai_bridge';

/**
 * Default settings. Relay mode is the default because staging/production sites
 * run on real domains, where a loopback (direct) connection would trip Chrome's
 * Local Network Access prompt.
 *
 * @return array<string,mixed>
 */
function etchwp_ai_bridge_defaults() {
	return array(
		'mode'       => 'relay',          // 'relay' | 'direct'
		'relay_url'  => '',                // wss://relay.example.com
		'room'       => 'default',
		'token'      => '',
		'host'       => '127.0.0.1',      // direct mode
		'port'       => 9223,             // direct mode
		'use_wss'    => 1,                // direct mode: wss vs ws
		'show_badge' => 1,                // editor connection badge
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
			'mode'      => $settings['mode'],
			'relayUrl'  => $settings['relay_url'],
			'room'      => $settings['room'],
			'token'     => $settings['token'],
			'host'      => $settings['host'],
			'port'      => (int) $settings['port'],
			'useWss'    => (bool) $settings['use_wss'],
			'showBadge' => (bool) $settings['show_badge'],
			'ajaxUrl'   => admin_url( 'admin-ajax.php' ),
			'nonce'     => wp_create_nonce( ETCHWP_AI_BRIDGE_NONCE ),
		)
	);
}
add_action( 'admin_enqueue_scripts', 'etchwp_ai_bridge_enqueue' );
add_action( 'wp_enqueue_scripts', 'etchwp_ai_bridge_enqueue' );

// --- Live status: agent heartbeat + settings poll ----------------------------

/** Agent → server: record the latest connection state. */
function etchwp_ai_bridge_ajax_heartbeat() {
	if ( ! check_ajax_referer( ETCHWP_AI_BRIDGE_NONCE, 'nonce', false ) || ! current_user_can( 'edit_posts' ) ) {
		wp_send_json_error( array( 'message' => 'forbidden' ), 403 );
	}
	$status = array(
		'state'       => isset( $_POST['state'] ) ? sanitize_text_field( wp_unslash( $_POST['state'] ) ) : 'unknown',
		'endpoint'    => isset( $_POST['endpoint'] ) ? sanitize_text_field( wp_unslash( $_POST['endpoint'] ) ) : '',
		'room'        => isset( $_POST['room'] ) ? sanitize_text_field( wp_unslash( $_POST['room'] ) ) : '',
		'mode'        => isset( $_POST['mode'] ) ? sanitize_text_field( wp_unslash( $_POST['mode'] ) ) : '',
		'hasEtch'     => ! empty( $_POST['hasEtch'] ) && 'false' !== $_POST['hasEtch'],
		'etchVersion' => isset( $_POST['etchVersion'] ) ? sanitize_text_field( wp_unslash( $_POST['etchVersion'] ) ) : '',
		'url'         => isset( $_POST['url'] ) ? esc_url_raw( wp_unslash( $_POST['url'] ) ) : '',
		'ts'          => time(),
		'user'        => wp_get_current_user()->display_name,
	);
	set_transient( ETCHWP_AI_BRIDGE_STATUS, $status, 5 * MINUTE_IN_SECONDS );
	wp_send_json_success();
}
add_action( 'wp_ajax_etchwp_ai_bridge_heartbeat', 'etchwp_ai_bridge_ajax_heartbeat' );

/** Settings page → server: read the latest agent status. */
function etchwp_ai_bridge_ajax_status() {
	if ( ! check_ajax_referer( ETCHWP_AI_BRIDGE_NONCE, 'nonce', false ) || ! current_user_can( 'manage_options' ) ) {
		wp_send_json_error( array( 'message' => 'forbidden' ), 403 );
	}
	$status = get_transient( ETCHWP_AI_BRIDGE_STATUS );
	if ( ! is_array( $status ) ) {
		wp_send_json_success( array( 'connected' => false, 'seen' => false ) );
	}
	$age = max( 0, time() - (int) ( $status['ts'] ?? 0 ) );
	$status['seen']       = true;
	$status['ageSeconds'] = $age;
	$status['connected']  = ( 'connected' === ( $status['state'] ?? '' ) ) && $age <= ETCHWP_AI_BRIDGE_FRESH;
	wp_send_json_success( $status );
}
add_action( 'wp_ajax_etchwp_ai_bridge_status', 'etchwp_ai_bridge_ajax_status' );

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
		'mode'       => ( isset( $input['mode'] ) && 'direct' === $input['mode'] ) ? 'direct' : 'relay',
		'relay_url'  => isset( $input['relay_url'] ) ? esc_url_raw( trim( (string) $input['relay_url'] ) ) : '',
		'room'       => isset( $input['room'] ) ? sanitize_text_field( (string) $input['room'] ) : 'default',
		'token'      => isset( $input['token'] ) ? sanitize_text_field( (string) $input['token'] ) : '',
		'host'       => isset( $input['host'] ) ? sanitize_text_field( (string) $input['host'] ) : '127.0.0.1',
		'port'       => isset( $input['port'] ) ? max( 1, min( 65535, (int) $input['port'] ) ) : 9223,
		'use_wss'    => ! empty( $input['use_wss'] ) ? 1 : 0,
		'show_badge' => ! empty( $input['show_badge'] ) ? 1 : 0,
	);
}

function etchwp_ai_bridge_menu() {
	$hook = add_options_page(
		__( 'etchwp-ai Bridge', 'etchwp-ai-bridge' ),
		__( 'etchwp-ai Bridge', 'etchwp-ai-bridge' ),
		'manage_options',
		'etchwp-ai-bridge',
		'etchwp_ai_bridge_settings_page'
	);
	add_action(
		'admin_enqueue_scripts',
		function ( $current ) use ( $hook ) {
			if ( $current !== $hook ) {
				return;
			}
			wp_enqueue_style(
				'etchwp-ai-bridge-admin',
				plugins_url( 'assets/admin.css', ETCHWP_AI_BRIDGE_FILE ),
				array(),
				ETCHWP_AI_BRIDGE_VERSION
			);
			wp_enqueue_script(
				'etchwp-ai-bridge-admin',
				plugins_url( 'assets/admin.js', ETCHWP_AI_BRIDGE_FILE ),
				array(),
				ETCHWP_AI_BRIDGE_VERSION,
				true
			);
			wp_localize_script(
				'etchwp-ai-bridge-admin',
				'EtchwpAiBridgeAdmin',
				array(
					'ajaxUrl' => admin_url( 'admin-ajax.php' ),
					'nonce'   => wp_create_nonce( ETCHWP_AI_BRIDGE_NONCE ),
					'option'  => ETCHWP_AI_BRIDGE_OPTION,
				)
			);
		}
	);
}
add_action( 'admin_menu', 'etchwp_ai_bridge_menu' );

function etchwp_ai_bridge_settings_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$s   = etchwp_ai_bridge_get_settings();
	$opt = ETCHWP_AI_BRIDGE_OPTION;
	?>
	<div class="wrap etchwp-ai-bridge">
		<h1><?php esc_html_e( 'etchwp-ai Bridge', 'etchwp-ai-bridge' ); ?></h1>
		<p class="description" style="max-width:780px">
			<?php esc_html_e( 'This plugin lets the etchwp-ai MCP server drive the Etch builder over a WebSocket — no Chrome debug flags. Configure it here, copy the matching environment block into your MCP server, then open a page in the Etch builder. The status panel below confirms when the in-page agent is talking.', 'etchwp-ai-bridge' ); ?>
		</p>

		<!-- Live status -->
		<div id="etchwp-status" class="etchwp-card etchwp-status" data-state="loading">
			<span class="etchwp-dot"></span>
			<div class="etchwp-status-text">
				<strong class="etchwp-status-title"><?php esc_html_e( 'Checking for the agent…', 'etchwp-ai-bridge' ); ?></strong>
				<span class="etchwp-status-detail"></span>
			</div>
		</div>

		<!-- Setup guide -->
		<div class="etchwp-card etchwp-guide">
			<h2><?php esc_html_e( 'Setup in 5 steps', 'etchwp-ai-bridge' ); ?></h2>
			<ol>
				<li><?php esc_html_e( 'Pick a Mode. Relay = your site is online (recommended). Direct = the MCP server runs on the same machine as your browser.', 'etchwp-ai-bridge' ); ?></li>
				<li><?php echo wp_kses_post( __( 'Click <strong>Generate</strong> to create a Shared token (a password that pairs your site with your MCP server).', 'etchwp-ai-bridge' ) ); ?></li>
				<li><?php esc_html_e( 'Fill the Relay fields (Relay mode) or Host/Port (Direct mode). Save changes.', 'etchwp-ai-bridge' ); ?></li>
				<li><?php echo wp_kses_post( __( 'Copy the <strong>MCP server environment</strong> block below into your etchwp-ai config (e.g. claude_desktop_config.json) and restart it.', 'etchwp-ai-bridge' ) ); ?></li>
				<li><?php esc_html_e( 'Open your page in the Etch builder. The status panel above turns green when the agent connects.', 'etchwp-ai-bridge' ); ?></li>
			</ol>
		</div>

		<form method="post" action="options.php">
			<?php settings_fields( 'etchwp_ai_bridge' ); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><?php esc_html_e( 'Mode', 'etchwp-ai-bridge' ); ?></th>
					<td>
						<label><input type="radio" id="etchwp-mode-relay" name="<?php echo esc_attr( $opt ); ?>[mode]" value="relay" <?php checked( $s['mode'], 'relay' ); ?>> <?php esc_html_e( 'Relay — your site is online; both sides dial a shared wss:// broker. No Chrome prompt, works across machines.', 'etchwp-ai-bridge' ); ?></label><br>
						<label><input type="radio" id="etchwp-mode-direct" name="<?php echo esc_attr( $opt ); ?>[mode]" value="direct" <?php checked( $s['mode'], 'direct' ); ?>> <?php esc_html_e( 'Direct — MCP server on the same machine; the agent connects to it on localhost. One-time Chrome Local Network Access prompt.', 'etchwp-ai-bridge' ); ?></label>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="etchwp-token"><?php esc_html_e( 'Shared token', 'etchwp-ai-bridge' ); ?></label></th>
					<td>
						<input type="text" id="etchwp-token" class="regular-text code" name="<?php echo esc_attr( $opt ); ?>[token]" value="<?php echo esc_attr( $s['token'] ); ?>" autocomplete="off" spellcheck="false">
						<button type="button" class="button" id="etchwp-gen-token"><?php esc_html_e( 'Generate', 'etchwp-ai-bridge' ); ?></button>
						<button type="button" class="button" data-etchwp-copy="#etchwp-token"><?php esc_html_e( 'Copy', 'etchwp-ai-bridge' ); ?></button>
						<p class="description"><?php esc_html_e( 'A shared secret that pairs this site with your MCP server. Must equal ETCH_WS_TOKEN on the server. Click Generate for a strong random value.', 'etchwp-ai-bridge' ); ?></p>
					</td>
				</tr>
				<tr class="etchwp-relay-only">
					<th scope="row"><label for="etchwp-relay-url"><?php esc_html_e( 'Relay URL', 'etchwp-ai-bridge' ); ?></label></th>
					<td><input type="text" id="etchwp-relay-url" class="regular-text code" placeholder="wss://relay.example.com" name="<?php echo esc_attr( $opt ); ?>[relay_url]" value="<?php echo esc_attr( $s['relay_url'] ); ?>" spellcheck="false">
						<p class="description"><?php esc_html_e( 'Address of your relay broker (the small service that forwards messages between the browser and the MCP server). Must equal ETCH_WS_RELAY_URL.', 'etchwp-ai-bridge' ); ?></p></td>
				</tr>
				<tr class="etchwp-relay-only">
					<th scope="row"><label for="etchwp-room"><?php esc_html_e( 'Room', 'etchwp-ai-bridge' ); ?></label></th>
					<td><input type="text" id="etchwp-room" class="regular-text code" name="<?php echo esc_attr( $opt ); ?>[room]" value="<?php echo esc_attr( $s['room'] ); ?>" spellcheck="false">
						<p class="description"><?php esc_html_e( 'A label (any word) that pairs THIS site with ONE MCP server on the relay. Give each site its own room. Must equal ETCH_WS_ROOM.', 'etchwp-ai-bridge' ); ?></p></td>
				</tr>
				<tr class="etchwp-direct-only">
					<th scope="row"><?php esc_html_e( 'Direct host / port', 'etchwp-ai-bridge' ); ?></th>
					<td>
						<input type="text" id="etchwp-host" name="<?php echo esc_attr( $opt ); ?>[host]" value="<?php echo esc_attr( $s['host'] ); ?>" size="16" spellcheck="false">
						:
						<input type="number" id="etchwp-port" min="1" max="65535" name="<?php echo esc_attr( $opt ); ?>[port]" value="<?php echo esc_attr( (string) $s['port'] ); ?>">
						<label style="margin-left:1em"><input type="checkbox" id="etchwp-wss" name="<?php echo esc_attr( $opt ); ?>[use_wss]" value="1" <?php checked( $s['use_wss'], 1 ); ?>> <?php esc_html_e( 'Use wss (TLS)', 'etchwp-ai-bridge' ); ?></label>
						<p class="description"><?php esc_html_e( 'Where the MCP server listens on this machine. Leave 127.0.0.1:9223 unless you changed ETCH_WS_PORT.', 'etchwp-ai-bridge' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Editor badge', 'etchwp-ai-bridge' ); ?></th>
					<td>
						<label><input type="checkbox" name="<?php echo esc_attr( $opt ); ?>[show_badge]" value="1" <?php checked( $s['show_badge'], 1 ); ?>> <?php esc_html_e( 'Show a small connection badge in the Etch editor', 'etchwp-ai-bridge' ); ?></label>
						<p class="description"><?php esc_html_e( 'Displays “● etchwp-ai connected” in the corner of the builder so you can see the agent is talking.', 'etchwp-ai-bridge' ); ?></p>
					</td>
				</tr>
			</table>
			<?php submit_button(); ?>
		</form>

		<!-- Copy-paste MCP server env -->
		<div class="etchwp-card">
			<h2><?php esc_html_e( 'MCP server environment', 'etchwp-ai-bridge' ); ?></h2>
			<p class="description"><?php esc_html_e( 'Paste this into your etchwp-ai MCP server config (the "env" block) and restart it. It updates live as you edit the fields above.', 'etchwp-ai-bridge' ); ?></p>
			<pre id="etchwp-env" class="etchwp-env"></pre>
			<button type="button" class="button button-secondary" data-etchwp-copy="#etchwp-env"><?php esc_html_e( 'Copy env block', 'etchwp-ai-bridge' ); ?></button>
		</div>
	</div>
	<?php
}
