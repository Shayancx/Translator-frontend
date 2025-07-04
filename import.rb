require 'elasticsearch'
require 'oj'

# --- Configuration ---
BATCH_SIZE = 100  # Reduced from 1000 to prevent timeouts
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
      },
      request: {
        timeout: 300  # 5 minute timeout
      }
    },
    user: 'elastic',
    password: '2u3DuVRvH4ZwIlA_u1dy',
    retry_on_failure: 3,
    retry_on_status: [502, 503, 504]
  )

  # 1. Check connection
  client.cluster.health
  print_success "Connection successful."

  # 2. Delete existing index if it exists
  if client.indices.exists?(index: INDEX_NAME)
    print_info "Deleting existing index '#{INDEX_NAME}'..."
    client.indices.delete(index: INDEX_NAME)
    print_success "Existing index deleted."
  end

  # 3. Create index with improved mapping
  print_info "Creating index '#{INDEX_NAME}' with improved mapping..."
  client.indices.create(
    index: INDEX_NAME,
    body: {
      mappings: {
        properties: {
          word: { 
            type: 'text',
            fields: {
              keyword: {
                type: 'keyword',
                normalizer: 'lowercase_normalizer'
              }
            }
          },
          senses: {
            type: 'nested',
            properties: {
              glosses: { type: 'text' },
              pos: { type: 'keyword' }
            }
          }
        }
      },
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
        refresh_interval: '-1',  # Disable refresh during import
        analysis: {
          normalizer: {
            lowercase_normalizer: {
              type: "custom",
              filter: ["lowercase", "asciifolding"]
            }
          }
        }
      }
    }
  )
  print_success "Index '#{INDEX_NAME}' created with improved mapping."

  print_info "Starting import of '#{FILE_PATH}'..."
  print_info "Batch size: #{BATCH_SIZE} (reduced to prevent timeouts)"
  print_info "Progress: [1 dot = #{BATCH_SIZE} words, 1 line = #{BATCH_SIZE * 50} words]"
  puts

  bulk_data = []
  line_count = 0
  error_count = 0
  imported_count = 0
  dot_count = 0

  # 4. Process the file and import data
  File.foreach(FILE_PATH) do |line|
    line_count += 1
    begin
      data = Oj.load(line)
      # Ensure the document has a 'word' field to be useful
      next unless data['word']

      source_data = {
        word: data['word'],
        senses: data['senses'] || []
      }
      bulk_data << { index: { _index: INDEX_NAME, data: source_data } }
      imported_count += 1
    rescue Oj::ParseError => e
      error_count += 1
      File.open(LOG_FILE, "a") { |f| f.puts "Line #{line_count}: Parse error - #{e.message}" }
      next
    rescue => e
      error_count += 1
      File.open(LOG_FILE, "a") { |f| f.puts "Line #{line_count}: Unexpected error - #{e.message}" }
      next
    end

    # When batch is full, send it to Elasticsearch
    if bulk_data.size >= BATCH_SIZE
      begin
        response = client.bulk(body: bulk_data, refresh: false)
        if response['errors']
          error_items = response['items'].select { |item| item['index']['error'] }
          error_count += error_items.size
          File.open(LOG_FILE, "a") do |f|
            error_items.each do |item|
              f.puts "Bulk error: #{item['index']['error']}"
            end
          end
        end
        bulk_data = []
        print "."
        dot_count += 1
        if dot_count >= 50
          puts " [#{imported_count} words]"
          dot_count = 0
        end
        $stdout.flush
      rescue => e
        print_error "\nBulk import error at line #{line_count}: #{e.message}"
        print_info "Retrying with smaller batch..."
        # Try again with half the batch
        bulk_data.each_slice(BATCH_SIZE / 2) do |mini_batch|
          begin
            client.bulk(body: mini_batch, refresh: false)
          rescue => mini_e
            print_error "Failed even with smaller batch: #{mini_e.message}"
            error_count += mini_batch.size
          end
        end
        bulk_data = []
      end
    end
  end

  # 5. Index any remaining data
  unless bulk_data.empty?
    begin
      client.bulk(body: bulk_data, refresh: false)
    rescue => e
      print_error "Final bulk error: #{e.message}"
      error_count += bulk_data.size
    end
  end
  
  puts if dot_count > 0  # Newline if we have trailing dots

  # 6. Re-enable refresh
  print_info "Re-enabling index refresh..."
  client.indices.put_settings(
    index: INDEX_NAME,
    body: { refresh_interval: '1s' }
  )
  
  # Force a refresh
  client.indices.refresh(index: INDEX_NAME)

  # 7. Final Report
  print_success "Import complete!"
  print_info "  Total lines processed: #{line_count}"
  print_info "  Successfully imported: #{imported_count} words"
  print_error "  Errors: #{error_count} (see #{LOG_FILE} for details)" if error_count > 0
  
  # Get actual document count
  count_response = client.count(index: INDEX_NAME)
  print_info "  Documents in index: #{count_response['count']}"

rescue Elasticsearch::Transport::Transport::Errors::Unauthorized
  print_error "Authentication failed. The username or password for Elasticsearch is incorrect."
rescue Faraday::ConnectionFailed, Faraday::SSLError
  print_error "Connection to Elasticsearch failed. Please ensure it's running and accessible at https://localhost:9200."
  print_error "Also, verify the certificate path in this script is correct."
rescue StandardError => e
  print_error "An unexpected error occurred:"
  puts e.message
  puts e.backtrace.first(5).join("\n")
end
