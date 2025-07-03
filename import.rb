require 'elasticsearch'
require 'oj'

# --- Configuration ---
BATCH_SIZE = 1000
INDEX_NAME = 'wiktionary'
FILE_PATH = 'raw-wiktextract-data.jsonl'
LOG_FILE = 'import_errors.log'

# --- Helper Functions for Colored Output ---
def print_success(message)
  puts "\e[32m✔ #{message}\e[0m"
end

def print_error(message)
  puts "\e[31m✖ #{message}\e[0m"
end

def print_info(message)
  puts "\e[34mℹ #{message}\e[0m"
end

# --- Main Script ---
begin
  print_info "Connecting to Elasticsearch on https://localhost:9200..."
  client = Elasticsearch::Client.new(
    host: 'https://localhost:9200',
    transport_options: {
      ssl: {
        ca_file: '/home/shayan/Dokumente/elasticsearch-9.0.3/config/certs/http_ca.crt'
      }
    },
    user: 'elastic',
    password: '2u3DuVRvH4ZwIlA_u1dy'
    # Note: log: true is removed for cleaner output
  )

  # 1. Check connection
  client.cluster.health
  print_success "Connection successful."

  # 2. Create index if it doesn't exist
  unless client.indices.exists?(index: INDEX_NAME)
    print_info "Index '#{INDEX_NAME}' not found. Creating it now..."
    client.indices.create(
      index: INDEX_NAME,
      body: {
        mappings: {
          properties: {
            word: { type: 'text', analyzer: 'standard' },
            senses: {
              type: 'nested',
              properties: {
                glosses: { type: 'text', analyzer: 'standard' }
              }
            }
          }
        }
      }
    )
    print_success "Index '#{INDEX_NAME}' created."
  else
    print_info "Index '#{INDEX_NAME}' already exists."
  end

  print_info "Starting import of '#{FILE_PATH}'. This may take a very long time."
  print_info "A dot will be printed for every #{BATCH_SIZE} words processed."

  bulk_data = []
  line_count = 0
  error_count = 0

  # 3. Process the file and import data
  File.foreach(FILE_PATH) do |line|
    line_count += 1
    begin
      data = Oj.load(line)
      # Ensure the document has a 'word' field to be useful
      next unless data['word']

      source_data = {
        word: data['word'],
        senses: data['senses'] || [] # Ensure senses is an array
      }
      bulk_data << { index: { _index: INDEX_NAME, data: source_data } }
    rescue Oj::ParseError
      error_count += 1
      File.open(LOG_FILE, "a") { |f| f.puts "Skipped malformed JSON at line #{line_count}" }
      next
    end

    # When batch is full, send it to Elasticsearch
    if bulk_data.size >= BATCH_SIZE
      client.bulk(body: bulk_data, refresh: false)
      bulk_data = []
      print "." # Progress indicator
    end
  end

  # 4. Index any remaining data
  client.bulk(body: bulk_data, refresh: true) unless bulk_data.empty?
  puts # Newline after the progress dots

  # 5. Final Report
  print_success "Import complete!"
  print_info "  Total lines processed: #{line_count}"
  print_info "  Successfully imported: #{line_count - error_count} words"
  print_error "  Skipped malformed lines: #{error_count} (see #{LOG_FILE} for details)" if error_count > 0

rescue Elasticsearch::Transport::Transport::Errors::Unauthorized
  print_error "Authentication failed. The username or password for Elasticsearch is incorrect."
rescue Faraday::ConnectionFailed, Faraday::SSLError
  print_error "Connection to Elasticsearch failed. Please ensure it's running and accessible at https://localhost:9200."
  print_error "Also, verify the certificate path in this script is correct."
rescue StandardError => e
  print_error "An unexpected error occurred:"
  puts e.message
end