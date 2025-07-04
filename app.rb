require 'roda'
require 'elasticsearch'
require 'oj'

class App < Roda
  plugin :public, root: '.'

  plugin :json

  es_client = Elasticsearch::Client.new(
    host: 'https://localhost:9200',
    transport_options: {
      ssl: {
        ca_file: '/home/shayan/Dokumente/elasticsearch-9.0.3/config/certs/http_ca.crt'
      }
    },
    user: 'elastic',
    password: '2u3DuVRvH4ZwIlA_u1dy',
    log: true
  )

  route do |r|
    r.public # Serve static files from the public directory (which is the root in this case)

    r.root do
      response['Content-Type'] = 'text/html'
      File.read('index.html')
    end

    r.on 'search' do
      r.get do
        word = r.params['word'].to_s.strip.downcase
        
        response = es_client.search(
          index: 'wiktionary',
          body: {
            query: {
              bool: {
                should: [
                  # Exact match gets highest priority
                  {
                    term: {
                      "word.keyword" => {
                        value: word,
                        boost: 100
                      }
                    }
                  },
                  # Case-insensitive exact match
                  {
                    match_phrase: {
                      word: {
                        query: word,
                        boost: 50
                      }
                    }
                  },
                  # Fuzzy match for typos (lowest priority)
                  {
                    match: {
                      word: {
                        query: word,
                        fuzziness: "AUTO",
                        prefix_length: 2,
                        boost: 1
                      }
                    }
                  }
                ],
                minimum_should_match: 1
              }
            },
            size: 10
          }
        )
        
        # Filter to return only the highest scoring result
        hits = response['hits']['hits']
        if hits.any?
          # Find exact match first
          exact = hits.find { |h| h['_source']['word'].downcase == word }
          if exact
            [exact['_source']]
          else
            # Return highest scoring result
            [hits.first['_source']]
          end
        else
          []
        end
      end
    end
  end
end
