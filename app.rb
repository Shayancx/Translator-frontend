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
        word = r.params['word']
        response = es_client.search(
          index: 'wiktionary',
          body: {
            query: {
              match: {
                word: word
              }
            }
          }
        )
        response['hits']['hits'].map { |hit| hit['_source'] }
      end
    end
  end
end
